from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pulseguard.config import get_settings


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "api.db"))
    monkeypatch.setenv("SIMULATOR_ENABLED", "false")
    monkeypatch.setenv("AZURE_EVENTHUB_ENABLED", "false")
    get_settings.cache_clear()
    from pulseguard import api as api_mod

    with TestClient(api_mod.app) as c:
        yield c
    get_settings.cache_clear()


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["service"] == "pulseguard"


def test_ingest_and_metrics(client: TestClient) -> None:
    r = client.post(
        "/ingest",
        json={
            "txn_id": "txn_api_1",
            "ts": 1_700_000_000.0,
            "account_id": "acc_0001",
            "merchant": "GiftCard Hub",
            "amount": 9000,
            "country": "US",
            "channel": "ecom",
            "status": "approved",
            "risk_score": 95,
            "high_risk": True,
        },
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    metrics = client.get("/metrics").json()
    assert "kpi" in metrics
    assert "thresholds" in metrics
    alerts = client.get("/alerts").json()["items"]
    assert len(alerts) >= 1
    ack = client.post(f"/alerts/{alerts[0]['alert_id']}/ack")
    assert ack.status_code == 200


def test_control_and_perf(client: TestClient) -> None:
    r = client.post("/control", json={"action": "fraud_spike"})
    assert r.status_code == 200
    assert r.json()["kpi"]["mode"] == "fraud_spike"
    r = client.post("/control", json={"action": "pipeline_fail"})
    assert r.json()["kpi"]["pipeline"] == "FAILED"
    r = client.post("/control", json={"action": "recover"})
    assert r.json()["kpi"]["pipeline"] == "LIVE"
    perf = client.post("/perf/run", json={"target_eps": 300, "duration_seconds": 0.5})
    assert perf.status_code == 200
    body = perf.json()
    assert body["events"] > 5
    assert body["success_rate"] == 1.0
