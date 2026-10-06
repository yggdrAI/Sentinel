from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Mode = Literal[
    "normal",
    "fraud_spike",
    "velocity_attack",
    "decline_storm",
    "pipeline_fail",
]
AlertStatus = Literal["ACTIVE", "ACKNOWLEDGED", "RESOLVED"]
Severity = Literal["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


class Transaction(BaseModel):
    txn_id: str
    ts: float
    account_id: str
    merchant: str
    amount: float
    country: str
    channel: str
    status: Literal["approved", "declined"]
    risk_score: float
    high_risk: bool = False
    processed_at: float | None = None


class Alert(BaseModel):
    alert_id: str
    created_at: float
    rule_id: str
    severity: Severity
    title: str
    reason: str
    entity: str
    value: float
    threshold: float
    status: AlertStatus = "ACTIVE"
    fingerprint: str
    acknowledged_at: float | None = None
    resolved_at: float | None = None


class KpiSnapshot(BaseModel):
    ts: float
    tps: float
    decline_rate: float
    avg_risk: float
    avg_amount: float
    high_risk_share: float
    active_alerts: int
    window_events: int = 0
    last_event_age_s: float = 0.0
    ingest_lag_ms: float = 0.0
    freshness: Literal["HEALTHY", "DEGRADED", "BREACHED"] = "HEALTHY"
    pipeline: Literal["LIVE", "PAUSED", "FAILED"] = "LIVE"
    mode: Mode = "normal"
    simulator_eps: float = 0.0


class ControlRequest(BaseModel):
    action: Literal[
        "normal",
        "fraud_spike",
        "velocity_attack",
        "decline_storm",
        "pipeline_fail",
        "recover",
        "set_rate",
        "set_thresholds",
        "clear_alerts",
    ]
    eps: float | None = Field(default=None, ge=0.1, le=500)
    amount_threshold: float | None = None
    decline_rate_threshold: float | None = None
    risk_score_threshold: float | None = None
    velocity_txn_per_min: int | None = None


class PerfRequest(BaseModel):
    target_eps: int = Field(default=2000, ge=100, le=20000)
    duration_seconds: float = Field(default=3.0, ge=0.5, le=30)


class PerfResult(BaseModel):
    started_at: float
    target_eps: int
    duration_s: float
    actual_eps: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    success_rate: float
    events: int
