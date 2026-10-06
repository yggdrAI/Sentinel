from __future__ import annotations

import random
import time
import uuid

from pulseguard.models import Mode, Transaction

ACCOUNTS = [f"acc_{i:04d}" for i in range(500)]
COUNTRIES = ["US", "GB", "IN", "DE", "SG", "BR", "CA", "AU", "FR", "JP"]
CHANNELS = ["ecom", "pos", "atm", "p2p"]
RETAIL = [
    "Northwind Market",
    "Contoso Coffee",
    "Fabrikam Transit",
    "Wide World Fuel",
    "Adventure Works",
    "Tailspin Grocery",
]
HIGH_RISK_MERCHANTS = [
    "CryptoNow Desk",
    "GiftCard Hub",
    "WireExpress Instant",
    "TokenBridge OTC",
]


def _id() -> str:
    return f"txn_{uuid.uuid4().hex[:12]}"


def generate_transaction(mode: Mode, now: float | None = None) -> Transaction:
    ts = now if now is not None else time.time()
    rng_fraud = {
        "normal": 0.03,
        "fraud_spike": 0.42,
        "velocity_attack": 0.12,
        "decline_storm": 0.08,
        "pipeline_fail": 0.03,
    }[mode]
    high = random.random() < rng_fraud
    if mode == "velocity_attack":
        account = ACCOUNTS[0]
    else:
        account = random.choice(ACCOUNTS[:40] if high else ACCOUNTS)

    if high:
        merchant = random.choice(HIGH_RISK_MERCHANTS)
        amount = round(random.uniform(1800, 9800), 2)
        channel = random.choice(["ecom", "p2p"])
        country = random.choice(["US", "SG", "GB", "IN"])
        decline = random.random() < (0.55 if mode == "decline_storm" else 0.22)
        risk = min(99.0, random.gauss(88, 6))
    else:
        merchant = random.choice(RETAIL)
        amount = round(max(4.0, random.lognormvariate(3.4, 0.7)), 2)
        channel = random.choice(CHANNELS)
        country = random.choice(COUNTRIES)
        decline = random.random() < (0.48 if mode == "decline_storm" else 0.04)
        risk = max(1.0, min(70.0, random.gauss(24, 12)))

    if mode == "decline_storm" and random.random() < 0.35:
        decline = True

    return Transaction(
        txn_id=_id(),
        ts=ts,
        account_id=account,
        merchant=merchant,
        amount=amount,
        country=country,
        channel=channel,
        status="declined" if decline else "approved",
        risk_score=round(risk, 1),
        high_risk=high,
    )
