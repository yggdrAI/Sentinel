"""
simulator/txn_generator.py
==========================
Financial transaction stream generator for SENTINEL.

Generates transactions with:
  - txn_id: UUID string
  - timestamp: ISO 8601 UTC timestamp
  - account_id: string identifier
  - merchant: merchant name
  - amount: transaction amount (float, 2 decimals)
  - region: geographical zone (NA, EU, APAC, etc.)
  - channel: payment method (online, mobile, pos, atm)
  - risk_score: fraud / risk score (0.0 to 100.0 or 0.0 to 1.0)

Modes supported:
  - normal: baseline traffic rate and normal risk profile
  - high_load: stress test volume (elevated TPS)
  - anomaly: unexpected metric deviations and elevated risk scores
  - burst_fraud: sudden spike of concentrated, high-risk fraudulent transactions
  - pipeline_failure: emission halts completely (simulates pipeline outage)

Mode is switchable via local FastAPI endpoint:
  GET  /mode/{name}
  POST /mode/{name}

Reads configuration from .env via python-dotenv.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import random
import string
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Environment Configuration
# ---------------------------------------------------------------------------

load_dotenv()


def _get_env_int(key: str, default: int) -> int:
    try:
        val = os.getenv(key)
        return int(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def _get_env_float(key: str, default: float) -> float:
    try:
        val = os.getenv(key)
        return float(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def _get_env_bool(key: str, default: bool) -> bool:
    val = os.getenv(key)
    if val is None:
        return default
    return val.strip().lower() in ("true", "1", "yes", "on")


NORMAL_TPS = _get_env_float("NORMAL_TPS", 20.0)
HIGH_LOAD_TPS = _get_env_float("HIGH_LOAD_TPS", 100.0)
ANOMALY_TPS = _get_env_float("ANOMALY_TPS", 35.0)
BURST_FRAUD_TPS = _get_env_float("BURST_FRAUD_TPS", 80.0)

SIMULATOR_HOST = os.getenv("SIMULATOR_HOST", "0.0.0.0")
SIMULATOR_PORT = _get_env_int("SIMULATOR_PORT", 8001)
EMIT_STDOUT = _get_env_bool("EMIT_STDOUT", True)

# ---------------------------------------------------------------------------
# Domain Models & Constants
# ---------------------------------------------------------------------------

REGIONS = ["north", "south", "east", "west", "central", "NA", "EU", "APAC"]
MERCHANTS = [
    "QuickMart", "TechBazaar", "FoodWorld", "TravelHub", "PayEasy",
    "ShopNow", "GlobalStore", "FlashBuy", "UrbanCart", "MegaMall"
]
CHANNELS = ["online", "mobile", "pos", "atm"]

FRAUD_ACCOUNTS = [f"ACC-FRAUD-{i:04d}" for i in range(1, 6)]
FRAUD_MERCHANTS = ["FlashBuy", "TechBazaar", "PayEasy"]


class SimMode(str, Enum):
    NORMAL = "normal"
    HIGH_LOAD = "high_load"
    ANOMALY = "anomaly"
    BURST_FRAUD = "burst_fraud"
    PIPELINE_FAILURE = "pipeline_failure"


MODE_ALIASES: Dict[str, SimMode] = {
    "normal": SimMode.NORMAL,
    "high_load": SimMode.HIGH_LOAD,
    "highload": SimMode.HIGH_LOAD,
    "high-load": SimMode.HIGH_LOAD,
    "anomaly": SimMode.ANOMALY,
    "anomalous": SimMode.ANOMALY,
    "burst_fraud": SimMode.BURST_FRAUD,
    "burstfraud": SimMode.BURST_FRAUD,
    "burst-fraud": SimMode.BURST_FRAUD,
    "fraud": SimMode.BURST_FRAUD,
    "pipeline_failure": SimMode.PIPELINE_FAILURE,
    "pipelinefailure": SimMode.PIPELINE_FAILURE,
    "pipeline-failure": SimMode.PIPELINE_FAILURE,
    "failure": SimMode.PIPELINE_FAILURE,
    "stop": SimMode.PIPELINE_FAILURE,
}


def parse_mode(name: str) -> SimMode:
    clean = name.strip().lower()
    if clean in MODE_ALIASES:
        return MODE_ALIASES[clean]
    valid = ", ".join(m.value for m in SimMode)
    raise ValueError(f"Unknown mode '{name}'. Valid modes: {valid}")


class Transaction(BaseModel):
    txn_id: str
    timestamp: str
    account_id: str
    merchant: str
    amount: float
    region: str
    channel: str
    risk_score: float

    def to_dict(self) -> Dict[str, Any]:
        if hasattr(self, "model_dump"):
            return self.model_dump()
        return self.dict()


class ModeResponse(BaseModel):
    ok: bool
    mode: str
    message: str
    target_tps: float
    running: bool


class StatusResponse(BaseModel):
    ok: bool
    mode: str
    running: bool
    target_tps: float
    total_generated: int
    queue_size: int
    available_modes: List[str]


# ---------------------------------------------------------------------------
# Generator Core Engine
# ---------------------------------------------------------------------------

class TransactionSimulator:
    def __init__(self) -> None:
        self.mode: SimMode = SimMode.NORMAL
        self.running: bool = True
        self.total_generated: int = 0
        self.queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=10000)
        self._producer_task: Optional[asyncio.Task] = None
        self._tick: int = 0

    def target_tps(self) -> float:
        if self.mode == SimMode.PIPELINE_FAILURE:
            return 0.0
        return {
            SimMode.NORMAL: NORMAL_TPS,
            SimMode.HIGH_LOAD: HIGH_LOAD_TPS,
            SimMode.ANOMALY: ANOMALY_TPS,
            SimMode.BURST_FRAUD: BURST_FRAUD_TPS,
        }.get(self.mode, NORMAL_TPS)

    def set_mode(self, mode: SimMode) -> None:
        self.mode = mode
        # In pipeline_failure mode, pause emissions
        self.running = (mode != SimMode.PIPELINE_FAILURE)

    def create_transaction(self) -> Transaction:
        self._tick += 1
        tick = self._tick
        mode = self.mode

        txn_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        if mode == SimMode.BURST_FRAUD:
            account_id = random.choice(FRAUD_ACCOUNTS)
            merchant = random.choice(FRAUD_MERCHANTS)
            # Mix of micro card-testing and large thefts
            if random.random() < 0.35:
                amount = round(random.uniform(1.0, 45.0), 2)
            else:
                amount = round(random.uniform(4000.0, 25000.0), 2)
            # High risk score
            risk_score = round(random.uniform(75.0, 99.0), 2)
            channel = random.choice(["online", "mobile"])
            region = random.choice(REGIONS)
        elif mode == SimMode.ANOMALY:
            account_id = f"ACC-{random.randint(100000, 999999)}"
            merchant = random.choice(MERCHANTS)
            amount = round(random.uniform(250.0, 8500.0) * (1.0 + 0.3 * math.sin(tick / 20.0)), 2)
            # Rising/cyclical elevated risk score
            anomaly_boost = 30.0 + 20.0 * abs(math.sin(tick / 15.0))
            risk_score = round(min(100.0, max(0.0, random.uniform(20.0, 45.0) + anomaly_boost)), 2)
            channel = random.choice(CHANNELS)
            region = random.choice(REGIONS)
        elif mode == SimMode.HIGH_LOAD:
            account_id = f"ACC-{random.randint(100000, 999999)}"
            merchant = random.choice(MERCHANTS)
            amount = round(random.uniform(10.0, 1500.0), 2)
            risk_score = round(random.uniform(5.0, 45.0), 2)
            channel = random.choice(CHANNELS)
            region = random.choice(REGIONS)
        else:  # normal
            account_id = f"ACC-{random.randint(100000, 999999)}"
            merchant = random.choice(MERCHANTS)
            amount = round(random.uniform(5.0, 850.0), 2)
            risk_score = round(random.uniform(1.0, 25.0), 2)
            channel = random.choice(CHANNELS)
            region = random.choice(REGIONS)

        return Transaction(
            txn_id=txn_id,
            timestamp=timestamp,
            account_id=account_id,
            merchant=merchant,
            amount=amount,
            region=region,
            channel=channel,
            risk_score=risk_score,
        )

    async def run_loop(self) -> None:
        while True:
            tps = self.target_tps()
            if not self.running or tps <= 0:
                await asyncio.sleep(0.2)
                continue

            interval = 1.0 / tps
            start_time = asyncio.get_event_loop().time()

            txn = self.create_transaction()
            self.total_generated += 1
            data = txn.to_dict()

            if EMIT_STDOUT:
                print(json.dumps(data), flush=True)

            try:
                self.queue.put_nowait(data)
            except asyncio.QueueFull:
                try:
                    self.queue.get_nowait()
                    self.queue.put_nowait(data)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

            elapsed = asyncio.get_event_loop().time() - start_time
            sleep_time = max(0.0, interval - elapsed)
            await asyncio.sleep(sleep_time)

    def start(self) -> None:
        if self._producer_task is None or self._producer_task.done():
            self._producer_task = asyncio.create_task(self.run_loop())

    def stop(self) -> None:
        if self._producer_task and not self._producer_task.done():
            self._producer_task.cancel()


simulator = TransactionSimulator()

# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    simulator.start()
    yield
    simulator.stop()


app = FastAPI(
    title="SENTINEL Transaction Generator",
    description="Live synthetic transaction generator with dynamic mode switching.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/mode/{name}", response_model=ModeResponse, summary="Switch simulation mode (GET)")
@app.post("/mode/{name}", response_model=ModeResponse, summary="Switch simulation mode (POST)")
async def switch_mode(name: str) -> ModeResponse:
    try:
        new_mode = parse_mode(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    simulator.set_mode(new_mode)
    return ModeResponse(
        ok=True,
        mode=new_mode.value,
        message=f"Simulation mode switched to '{new_mode.value}'",
        target_tps=simulator.target_tps(),
        running=simulator.running,
    )


@app.get("/status", response_model=StatusResponse, summary="Get simulator status")
async def get_status() -> StatusResponse:
    return StatusResponse(
        ok=True,
        mode=simulator.mode.value,
        running=simulator.running,
        target_tps=simulator.target_tps(),
        total_generated=simulator.total_generated,
        queue_size=simulator.queue.qsize(),
        available_modes=[m.value for m in SimMode],
    )


@app.get("/next", summary="Retrieve next buffered transaction")
async def get_next() -> JSONResponse:
    try:
        txn = simulator.queue.get_nowait()
        return JSONResponse(content=txn)
    except asyncio.QueueEmpty:
        raise HTTPException(status_code=204, detail="No buffered transactions available")


@app.get("/batch", summary="Retrieve a batch of buffered transactions")
async def get_batch(limit: int = 50) -> JSONResponse:
    items = []
    for _ in range(max(1, min(limit, 500))):
        try:
            items.append(simulator.queue.get_nowait())
        except asyncio.QueueEmpty:
            break
    return JSONResponse(content=items)


@app.get("/health", summary="Service health check")
async def health_check() -> JSONResponse:
    healthy = simulator.running and simulator.mode != SimMode.PIPELINE_FAILURE
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "healthy" if healthy else "degraded",
            "mode": simulator.mode.value,
            "running": simulator.running,
            "target_tps": simulator.target_tps(),
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=SIMULATOR_HOST, port=SIMULATOR_PORT)
