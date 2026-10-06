from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pulseguard.azure_sink import AzureSink
from pulseguard.config import Settings, get_settings
from pulseguard.db import Database
from pulseguard.engine import Pipeline
from pulseguard.models import ControlRequest, PerfRequest, Transaction
from pulseguard.simulator import generate_transaction

log = logging.getLogger("pulseguard.api")
STATE: dict[str, Any] = {}


def _pipe() -> Pipeline:
    return STATE["pipeline"]


async def _simulator() -> None:
    pipe: Pipeline = STATE["pipeline"]
    settings: Settings = STATE["settings"]
    while True:
        try:
            if settings.simulator_enabled and pipe.running and not pipe.pipeline_down:
                pipe.ingest(generate_transaction(pipe.mode))
            await asyncio.sleep(1.0 / max(pipe.eps, 0.2))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("simulator tick failed")
            await asyncio.sleep(0.5)


async def _housekeeping() -> None:
    pipe: Pipeline = STATE["pipeline"]
    while True:
        try:
            pipe.record_kpi()
            pipe.check_freshness()
        except Exception:
            log.exception("housekeeping failed")
        await asyncio.sleep(2.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db = Database(settings.db_path)
    sink = AzureSink(
        enabled=settings.azure_eventhub_enabled,
        connection_string=settings.azure_eventhub_connection_string,
        hub_name=settings.azure_eventhub_name,
        batch_size=settings.azure_eventhub_batch_size,
    )
    pipe = Pipeline(settings=settings, db=db, sink=sink)
    STATE.update(settings=settings, db=db, sink=sink, pipeline=pipe)
    sim = asyncio.create_task(_simulator(), name="simulator")
    house = asyncio.create_task(_housekeeping(), name="housekeeping")
    yield
    sim.cancel()
    house.cancel()
    sink.close()
    db.close()


app = FastAPI(title="PulseGuard", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    pipe = _pipe()
    snap = pipe.snapshot()
    return {
        "ok": True,
        "service": "pulseguard",
        "freshness": snap.freshness,
        "pipeline": snap.pipeline,
        "last_event_age_s": snap.last_event_age_s,
        "processed": pipe.processed,
        "ingest_errors": pipe.ingest_errors,
        "azure": STATE["sink"].status(),
    }


@app.get("/metrics")
def metrics() -> dict[str, Any]:
    pipe = _pipe()
    snap = pipe.snapshot()
    t = pipe.thresholds
    return {
        "kpi": snap.model_dump(),
        "thresholds": {
            "amount": t.amount,
            "decline_rate": t.decline_rate,
            "risk_score": t.risk_score,
            "velocity_txn_per_min": t.velocity,
            "high_risk_share": t.high_risk_share,
            "freshness_sla_seconds": t.freshness_sla,
        },
        "processed": pipe.processed,
        "ingest_errors": pipe.ingest_errors,
        "azure": STATE["sink"].status(),
    }


@app.get("/kpis")
def kpis() -> dict[str, Any]:
    pipe = _pipe()
    history = [s.model_dump() for s in pipe.kpi_history]
    if not history:
        history = [pipe.record_kpi().model_dump()]
    return {"current": pipe.snapshot().model_dump(), "history": history}


@app.get("/transactions")
def transactions(limit: int = 80) -> dict[str, Any]:
    limit = max(1, min(limit, 300))
    rows = _pipe().db.fetchall(
        "SELECT * FROM transactions ORDER BY ts DESC LIMIT ?", (limit,)
    )
    return {"items": [dict(r) for r in rows]}


@app.get("/alerts")
def alerts(status: str | None = None, limit: int = 80) -> dict[str, Any]:
    limit = max(1, min(limit, 300))
    db = _pipe().db
    if status:
        rows = db.fetchall(
            "SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status.upper(), limit),
        )
    else:
        rows = db.fetchall(
            "SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?", (limit,)
        )
    return {"items": [dict(r) for r in rows]}


@app.post("/alerts/{alert_id}/ack")
def ack(alert_id: str) -> dict[str, bool]:
    if not _pipe().ack(alert_id):
        raise HTTPException(404, "alert not found")
    return {"ok": True}


@app.post("/alerts/{alert_id}/resolve")
def resolve(alert_id: str) -> dict[str, bool]:
    if not _pipe().resolve(alert_id):
        raise HTTPException(404, "alert not found")
    return {"ok": True}


@app.post("/ingest")
def ingest(txn: Transaction) -> dict[str, Any]:
    alerts = _pipe().ingest(txn)
    return {"ok": True, "alerts": [a.model_dump() for a in alerts]}


@app.post("/control")
def control(req: ControlRequest) -> dict[str, Any]:
    pipe = _pipe()
    if req.action == "recover":
        pipe.set_mode("normal")
        pipe.running = True
        pipe.pipeline_down = False
        pipe.recover_freshness_alerts()
    elif req.action == "clear_alerts":
        pipe.db.execute(
            "UPDATE alerts SET status = 'RESOLVED', resolved_at = ? WHERE status != 'RESOLVED'",
            (time.time(),),
        )
    elif req.action == "set_rate":
        if req.eps is None:
            raise HTTPException(400, "eps required")
        pipe.eps = req.eps
    elif req.action == "set_thresholds":
        if req.amount_threshold is not None:
            pipe.thresholds.amount = req.amount_threshold
        if req.decline_rate_threshold is not None:
            pipe.thresholds.decline_rate = req.decline_rate_threshold
        if req.risk_score_threshold is not None:
            pipe.thresholds.risk_score = req.risk_score_threshold
        if req.velocity_txn_per_min is not None:
            pipe.thresholds.velocity = req.velocity_txn_per_min
    elif req.action == "pipeline_fail":
        pipe.set_mode("pipeline_fail")
    else:
        pipe.set_mode(req.action)
        pipe.running = True
    return {"ok": True, "kpi": pipe.snapshot().model_dump()}


@app.post("/perf/run")
def perf_run(req: PerfRequest) -> dict[str, Any]:
    result = _pipe().load_test(req.target_eps, req.duration_seconds)
    return result.model_dump()


@app.get("/perf")
def perf_history() -> dict[str, Any]:
    rows = _pipe().db.fetchall("SELECT * FROM perf_runs ORDER BY started_at DESC LIMIT 20")
    return {"items": [dict(r) for r in rows]}
