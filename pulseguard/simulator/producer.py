import asyncio
import os
import random
import uuid
from datetime import datetime, timezone
from typing import Literal
import logging

from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

logger = logging.getLogger(__name__)

class Transaction(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_time: str  # ISO 8601 UTC
    ingest_time: str  # ISO 8601 UTC when processed
    merchant: str
    region: str
    card_id: str
    amount: float
    status: Literal["approved", "declined"]
    risk_score: float  # 0-1

# Helper data
MERCHANTS = ["Amazon", "Walmart", "Target", "BestBuy", "Etsy"]
REGIONS = ["US", "EU", "APAC", "LATAM"]
CARDS = [f"CARD{i:04d}" for i in range(1, 101)]

class AttackMode:
    NONE = "none"
    CARD_TESTING = "card_testing"
    ACCOUNT_TAKEOVER = "account_takeover"
    MERCHANT_BURST = "merchant_burst"

class Producer:
    def __init__(self):
        self.base_rate = int(os.getenv("SIMULATOR_RATE", "10"))
        self.attack_mode: str = os.getenv("ATTACK_MODE", AttackMode.NONE)
        self._stop = asyncio.Event()
        self._duplicate_chance = 0.01
        self._late_event_chance = 0.02
        self._last_txn: Transaction | None = None
        self._sink = None  # will be set by run()

    def set_sink(self, sink):
        self._sink = sink

    def set_attack(self, mode: str):
        self.attack_mode = mode
        logger.info(f"Attack mode set to {mode}")

    def stop(self):
        self._stop.set()

    async def _generate_one(self) -> Transaction:
        now = datetime.now(timezone.utc)
        merchant = random.choice(MERCHANTS)
        region = random.choice(REGIONS)
        card_id = random.choice(CARDS)
        amount = random.uniform(5, 500)
        status = "approved"
        risk_score = random.random() * 0.3  # low risk baseline

        # Apply attack modifications
        if self.attack_mode == AttackMode.CARD_TESTING:
            # many small declined on few cards
            card_id = random.choice(CARDS[:5])
            amount = random.uniform(1, 20)
            status = "declined"
            risk_score = random.uniform(0.5, 0.9)
        elif self.attack_mode == AttackMode.ACCOUNT_TAKEOVER:
            # high amounts, new region
            amount = random.uniform(1000, 5000)
            region = random.choice([r for r in REGIONS if r != region])
            status = "approved"
            risk_score = random.uniform(0.7, 1.0)
        elif self.attack_mode == AttackMode.MERCHANT_BURST:
            merchant = random.choice(MERCHANTS[:1])
            amount = random.uniform(200, 2000)
            risk_score = random.uniform(0.6, 0.95)
        
        txn = Transaction(
            event_time=now.isoformat(),
            ingest_time=now.isoformat(),
            merchant=merchant,
            region=region,
            card_id=card_id,
            amount=round(amount, 2),
            status=status,
            risk_score=round(risk_score, 3),
        )
        return txn

    async def run(self):
        if not self._sink:
            raise RuntimeError("Sink not set for Producer")
        while not self._stop.is_set():
            # Occasionally emit duplicate
            if self._last_txn and random.random() < self._duplicate_chance:
                txn = self._last_txn
                logger.debug("Emitting duplicate transaction %s", txn.event_id)
            else:
                txn = await self._generate_one()
                self._last_txn = txn

            # Occasionally make event_time slightly earlier (late arrival)
            if random.random() < self._late_event_chance:
                late_seconds = random.randint(1, 30)
                late_time = datetime.fromisoformat(txn.event_time) - timedelta(seconds=late_seconds)
                txn.event_time = late_time.isoformat()
                logger.debug("Late event %s by %d s", txn.event_id, late_seconds)

            await self._sink.send([txn.dict()])
            await asyncio.sleep(1 / self.base_rate)

        logger.info("Producer stopped")
