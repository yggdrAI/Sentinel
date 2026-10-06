from __future__ import annotations

import time

from pulseguard.config import Settings
from pulseguard.db import Database
from pulseguard.engine import Pipeline
from pulseguard.models import Transaction
from pulseguard.simulator import generate_transaction


def _pipe(tmp_path) -> Pipeline:
    settings = Settings(database_path=str(tmp_path / "pg.db"), simulator_enabled=False)
    return Pipeline(settings=settings, db=Database(settings.db_path))


def test_wal_mode(tmp_path) -> None:
    pipe = _pipe(tmp_path)
    mode = pipe.db.fetchone("PRAGMA journal_mode;")
    assert str(mode[0]).lower() == "wal"


def test_amount_threshold_alert(tmp_path) -> None:
    pipe = _pipe(tmp_path)
    pipe.thresholds.amount = 1000
    txn = Transaction(
        txn_id="txn_test_amt",
        ts=time.time(),
        account_id="acc_0001",
        merchant="Wide World Fuel",
        amount=5000,
        country="US",
        channel="ecom",
        status="approved",
        risk_score=20,
        high_risk=False,
    )
    alerts = pipe.ingest(txn)
    assert any(a.rule_id == "amount" for a in alerts)
    # duplicate fingerprint should not open a second active alert
    txn2 = txn.model_copy(update={"txn_id": "txn_test_amt2", "ts": time.time()})
    assert pipe.ingest(txn2) == []


def test_velocity_alert(tmp_path) -> None:
    pipe = _pipe(tmp_path)
    pipe.thresholds.velocity = 3
    now = time.time()
    fired: list = []
    for i in range(4):
        fired.extend(
            pipe.ingest(
                Transaction(
                    txn_id=f"txn_vel_{i}",
                    ts=now + i * 0.01,
                    account_id="acc_0099",
                    merchant="Contoso Coffee",
                    amount=12,
                    country="US",
                    channel="pos",
                    status="approved",
                    risk_score=10,
                )
            )
        )
    assert any(a.rule_id == "velocity" for a in fired)


def test_freshness_sla_breach_and_recover(tmp_path) -> None:
    pipe = _pipe(tmp_path)
    pipe.thresholds.freshness_sla = 2
    pipe.last_event_ts = time.time() - 10
    alert = pipe.check_freshness()
    assert alert is not None
    assert alert.rule_id == "freshness"
    assert pipe.snapshot().freshness == "BREACHED"
    pipe.last_event_ts = time.time()
    pipe.recover_freshness_alerts()
    row = pipe.db.fetchone(
        "SELECT status FROM alerts WHERE rule_id = 'freshness' ORDER BY created_at DESC LIMIT 1"
    )
    assert row["status"] == "RESOLVED"


def test_ack_resolve(tmp_path) -> None:
    pipe = _pipe(tmp_path)
    pipe.thresholds.risk_score = 50
    alerts = pipe.ingest(
        Transaction(
            txn_id="txn_risk",
            ts=time.time(),
            account_id="acc_0002",
            merchant="CryptoNow Desk",
            amount=100,
            country="US",
            channel="ecom",
            status="approved",
            risk_score=90,
            high_risk=True,
        )
    )
    assert alerts
    aid = alerts[0].alert_id
    assert pipe.ack(aid)
    assert pipe.resolve(aid)
    row = pipe.db.fetchone("SELECT status FROM alerts WHERE alert_id = ?", (aid,))
    assert row["status"] == "RESOLVED"


def test_load_test_success(tmp_path) -> None:
    pipe = _pipe(tmp_path)
    result = pipe.load_test(target_eps=400, duration_s=0.6)
    assert result.events > 10
    assert result.success_rate == 1.0
    assert result.p95_ms >= 0


def test_generator_modes() -> None:
    n = generate_transaction("normal")
    assert n.txn_id.startswith("txn_")
    v = generate_transaction("velocity_attack")
    assert v.account_id == "acc_0000"
