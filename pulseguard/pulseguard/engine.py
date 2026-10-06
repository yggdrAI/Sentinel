from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from statistics import quantiles

log = logging.getLogger("pulseguard.engine")

from pulseguard.config import Settings
from pulseguard.db import Database
from pulseguard.models import Alert, KpiSnapshot, Mode, PerfResult, Transaction
from pulseguard.simulator import HIGH_RISK_MERCHANTS, generate_transaction


def _alert_id() -> str:
    return f"alt_{uuid.uuid4().hex[:12]}"


@dataclass
class Thresholds:
    amount: float
    decline_rate: float
    risk_score: float
    velocity: int
    high_risk_share: float
    freshness_sla: float


@dataclass
class Pipeline:
    settings: Settings
    db: Database
    sink: object | None = None
    mode: Mode = "normal"
    running: bool = True
    pipeline_down: bool = False
    eps: float = 12.0
    thresholds: Thresholds = field(init=False)
    window: deque[Transaction] = field(default_factory=lambda: deque(maxlen=4000))
    by_account: dict[str, deque[float]] = field(
        default_factory=lambda: defaultdict(lambda: deque(maxlen=200))
    )
    kpi_history: deque[KpiSnapshot] = field(default_factory=lambda: deque(maxlen=180))
    last_event_ts: float = 0.0
    last_ingest_lag_ms: float = 0.0
    processed: int = 0
    ingest_errors: int = 0
    _prune_at: float = 0.0

    def __post_init__(self) -> None:
        self.eps = self.settings.simulator_eps
        self.thresholds = Thresholds(
            amount=self.settings.amount_threshold,
            decline_rate=self.settings.decline_rate_threshold,
            risk_score=self.settings.risk_score_threshold,
            velocity=self.settings.velocity_txn_per_min,
            high_risk_share=self.settings.high_risk_merchant_share_threshold,
            freshness_sla=self.settings.freshness_sla_seconds,
        )

    def ingest(self, txn: Transaction) -> list[Alert]:
        try:
            now = time.time()
            txn.processed_at = now
            self.last_ingest_lag_ms = max(0.0, (now - txn.ts) * 1000.0)
            self.last_event_ts = txn.ts
            self.window.append(txn)
            self.by_account[txn.account_id].append(txn.ts)
            self.processed += 1
            self.db.execute(
                """
                INSERT OR IGNORE INTO transactions
                (txn_id, ts, account_id, merchant, amount, country, channel, status, risk_score, high_risk, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    txn.txn_id,
                    txn.ts,
                    txn.account_id,
                    txn.merchant,
                    txn.amount,
                    txn.country,
                    txn.channel,
                    txn.status,
                    txn.risk_score,
                    1 if txn.high_risk else 0,
                    txn.processed_at,
                ),
            )
            alerts = self.evaluate(txn)
            for alert in alerts:
                self._persist_alert(alert)
            if self.sink is not None:
                self.sink.offer(txn.model_dump())
            if now - self._prune_at > 30:
                self.db.prune()
                self._prune_at = now
            return alerts
        except Exception:
            self.ingest_errors += 1
            log.exception("ingest failed for %s", getattr(txn, "txn_id", "?"))
            return []

    def evaluate(self, txn: Transaction) -> list[Alert]:
        now = txn.ts
        alerts: list[Alert] = []
        recent = [t for t in self.window if now - t.ts <= 60]
        if not recent:
            recent = list(self.window)[-1:]

        decline_rate = sum(1 for t in recent if t.status == "declined") / max(len(recent), 1)
        hr_share = sum(1 for t in recent if t.merchant in HIGH_RISK_MERCHANTS) / max(
            len(recent), 1
        )
        stamps = self.by_account[txn.account_id]
        velocity = sum(1 for ts in stamps if now - ts <= 60)

        if txn.amount >= self.thresholds.amount:
            alerts.append(
                self._make(
                    "amount",
                    "HIGH" if txn.amount < self.thresholds.amount * 2 else "CRITICAL",
                    "High-value transaction",
                    f"{txn.account_id} sent ${txn.amount:,.2f} at {txn.merchant}, "
                    f"above the ${self.thresholds.amount:,.0f} amount threshold.",
                    txn.account_id,
                    txn.amount,
                    self.thresholds.amount,
                )
            )
        if txn.risk_score >= self.thresholds.risk_score:
            alerts.append(
                self._make(
                    "risk_score",
                    "HIGH" if txn.risk_score < 92 else "CRITICAL",
                    "Risk score breach",
                    f"Txn {txn.txn_id} scored {txn.risk_score:.1f} "
                    f"(threshold {self.thresholds.risk_score:.0f}) via {txn.channel}/{txn.merchant}.",
                    txn.txn_id,
                    txn.risk_score,
                    self.thresholds.risk_score,
                )
            )
        if velocity >= self.thresholds.velocity:
            alerts.append(
                self._make(
                    "velocity",
                    "CRITICAL",
                    "Account velocity attack",
                    f"{txn.account_id} has {velocity} txns in 60s "
                    f"(threshold {self.thresholds.velocity}/min).",
                    txn.account_id,
                    float(velocity),
                    float(self.thresholds.velocity),
                )
            )
        if len(recent) >= 20 and decline_rate >= self.thresholds.decline_rate:
            alerts.append(
                self._make(
                    "decline_rate",
                    "HIGH",
                    "Decline-rate spike",
                    f"Rolling 60s decline rate is {decline_rate:.0%} "
                    f"(threshold {self.thresholds.decline_rate:.0%}).",
                    "portfolio",
                    decline_rate,
                    self.thresholds.decline_rate,
                )
            )
        if len(recent) >= 20 and hr_share >= self.thresholds.high_risk_share:
            alerts.append(
                self._make(
                    "high_risk_share",
                    "MEDIUM",
                    "High-risk merchant mix",
                    f"{hr_share:.0%} of the last minute is high-risk merchants "
                    f"(threshold {self.thresholds.high_risk_share:.0%}).",
                    "portfolio",
                    hr_share,
                    self.thresholds.high_risk_share,
                )
            )
        return [a for a in alerts if self._should_open(a)]

    def _make(
        self,
        rule_id: str,
        severity: str,
        title: str,
        reason: str,
        entity: str,
        value: float,
        threshold: float,
    ) -> Alert:
        fp = f"{rule_id}:{entity}"
        return Alert(
            alert_id=_alert_id(),
            created_at=time.time(),
            rule_id=rule_id,
            severity=severity,  # type: ignore[arg-type]
            title=title,
            reason=reason,
            entity=entity,
            value=value,
            threshold=threshold,
            fingerprint=fp,
        )

    def _should_open(self, alert: Alert) -> bool:
        row = self.db.fetchone(
            "SELECT 1 FROM alerts WHERE fingerprint = ? AND status != 'RESOLVED' LIMIT 1",
            (alert.fingerprint,),
        )
        return row is None

    def _persist_alert(self, alert: Alert) -> None:
        self.db.execute(
            """
            INSERT INTO alerts
            (alert_id, created_at, rule_id, severity, title, reason, entity, value, threshold, status, fingerprint, acknowledged_at, resolved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                alert.alert_id,
                alert.created_at,
                alert.rule_id,
                alert.severity,
                alert.title,
                alert.reason,
                alert.entity,
                alert.value,
                alert.threshold,
                alert.status,
                alert.fingerprint,
                alert.acknowledged_at,
                alert.resolved_at,
            ),
        )

    def check_freshness(self) -> Alert | None:
        snap = self.snapshot()
        if snap.freshness != "BREACHED":
            return None
        alert = self._make(
            "freshness",
            "CRITICAL",
            "Data freshness SLA breach",
            f"Last event is {snap.last_event_age_s:.1f}s old; SLA is {self.thresholds.freshness_sla:.0f}s. "
            f"Pipeline={snap.pipeline}.",
            "pipeline",
            snap.last_event_age_s,
            self.thresholds.freshness_sla,
        )
        if self._should_open(alert):
            self._persist_alert(alert)
            return alert
        return None

    def recover_freshness_alerts(self) -> None:
        now = time.time()
        self.db.execute(
            """
            UPDATE alerts
            SET status = 'RESOLVED', resolved_at = ?
            WHERE rule_id = 'freshness' AND status != 'RESOLVED'
            """,
            (now,),
        )

    def snapshot(self) -> KpiSnapshot:
        now = time.time()
        recent = [t for t in self.window if now - t.ts <= 60]
        n = len(recent)
        tps = n / 60.0 if n else 0.0
        decline = sum(1 for t in recent if t.status == "declined") / n if n else 0.0
        avg_risk = sum(t.risk_score for t in recent) / n if n else 0.0
        avg_amt = sum(t.amount for t in recent) / n if n else 0.0
        hr = sum(1 for t in recent if t.high_risk) / n if n else 0.0
        active = self.db.fetchone(
            "SELECT COUNT(*) AS c FROM alerts WHERE status != 'RESOLVED'"
        )
        age = 0.0 if self.last_event_ts == 0 else now - self.last_event_ts
        sla = self.thresholds.freshness_sla
        if self.last_event_ts == 0:
            freshness = "HEALTHY"
        elif age > sla:
            freshness = "BREACHED"
        elif age > sla * 0.6:
            freshness = "DEGRADED"
        else:
            freshness = "HEALTHY"
        if self.pipeline_down:
            pipeline = "FAILED"
        elif not self.running:
            pipeline = "PAUSED"
        else:
            pipeline = "LIVE"
        return KpiSnapshot(
            ts=now,
            tps=round(tps, 2),
            decline_rate=round(decline, 4),
            avg_risk=round(avg_risk, 2),
            avg_amount=round(avg_amt, 2),
            high_risk_share=round(hr, 4),
            active_alerts=int(active["c"] if active else 0),
            window_events=n,
            last_event_age_s=round(age, 2),
            ingest_lag_ms=round(self.last_ingest_lag_ms, 2),
            freshness=freshness,  # type: ignore[arg-type]
            pipeline=pipeline,  # type: ignore[arg-type]
            mode=self.mode,
            simulator_eps=self.eps,
        )

    def record_kpi(self) -> KpiSnapshot:
        snap = self.snapshot()
        self.kpi_history.append(snap)
        self.db.execute(
            """
            INSERT OR REPLACE INTO kpi_points
            (ts, tps, decline_rate, avg_risk, avg_amount, high_risk_share, active_alerts)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snap.ts,
                snap.tps,
                snap.decline_rate,
                snap.avg_risk,
                snap.avg_amount,
                snap.high_risk_share,
                snap.active_alerts,
            ),
        )
        return snap

    def set_mode(self, mode: Mode) -> None:
        if mode == "pipeline_fail":
            self.pipeline_down = True
            self.mode = "pipeline_fail"
            return
        self.mode = mode
        self.pipeline_down = False
        if mode != "pipeline_fail":
            self.recover_freshness_alerts()

    def ack(self, alert_id: str) -> bool:
        now = time.time()
        before = self.db.fetchone(
            "SELECT status FROM alerts WHERE alert_id = ?", (alert_id,)
        )
        if not before:
            return False
        self.db.execute(
            "UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_at = ? WHERE alert_id = ? AND status = 'ACTIVE'",
            (now, alert_id),
        )
        return True

    def resolve(self, alert_id: str) -> bool:
        now = time.time()
        row = self.db.fetchone("SELECT 1 FROM alerts WHERE alert_id = ?", (alert_id,))
        if not row:
            return False
        self.db.execute(
            "UPDATE alerts SET status = 'RESOLVED', resolved_at = ? WHERE alert_id = ?",
            (now, alert_id),
        )
        return True

    def load_test(self, target_eps: int, duration_s: float) -> PerfResult:
        started = time.time()
        latencies: list[float] = []
        ok = 0
        events = 0
        deadline = started + duration_s
        interval = 1.0 / max(target_eps, 1)
        next_t = time.perf_counter()
        saved_mode = self.mode
        while time.time() < deadline:
            txn = generate_transaction("fraud_spike" if events % 17 == 0 else "normal")
            t0 = time.perf_counter()
            try:
                self.ingest(txn)
                ok += 1
            except Exception:
                self.ingest_errors += 1
            latencies.append((time.perf_counter() - t0) * 1000.0)
            events += 1
            next_t += interval
            sleep_for = next_t - time.perf_counter()
            if sleep_for > 0:
                time.sleep(sleep_for)
            elif sleep_for < -0.25:
                next_t = time.perf_counter()
        elapsed = max(time.time() - started, 1e-6)
        self.mode = saved_mode
        def pct(p: float) -> float:
            if not latencies:
                return 0.0
            if len(latencies) == 1:
                return round(latencies[0], 3)
            qs = quantiles(latencies, n=100, method="inclusive")
            return round(qs[min(99, max(0, int(p) - 1))], 3)

        result = PerfResult(
            started_at=started,
            target_eps=target_eps,
            duration_s=round(elapsed, 3),
            actual_eps=round(events / elapsed, 1),
            p50_ms=pct(50),
            p95_ms=pct(95),
            p99_ms=pct(99),
            success_rate=round(ok / max(events, 1), 4),
            events=events,
        )
        self.db.execute(
            """
            INSERT INTO perf_runs
            (started_at, target_eps, duration_s, actual_eps, p50_ms, p95_ms, p99_ms, success_rate, events)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result.started_at,
                result.target_eps,
                result.duration_s,
                result.actual_eps,
                result.p50_ms,
                result.p95_ms,
                result.p99_ms,
                result.success_rate,
                result.events,
            ),
        )
        return result
