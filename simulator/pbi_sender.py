"""
simulator/pbi_sender.py
=======================
Consumes transactions from the SENTINEL simulator and sends them
to the Power BI Streaming Dataset Push URL specified in .env.

Specifications:
  - Sends every 1 second, up to 50 transactions per batch.
  - Whitelist filter: ONLY sends [txn_id, timestamp, account_id, merchant,
    amount, region, channel, risk_score].
  - On failure, retries up to 5 times.
  - Logs all successes and failures to logs/sender.log.
  - Supports live streaming from running txn_generator API, with fallback
    to in-process generator if simulator service is not running.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load Configuration
# ---------------------------------------------------------------------------

# Search for .env in current dir, parent dir, or script dir
script_dir = Path(__file__).resolve().parent
repo_root = script_dir.parent
for env_path in [script_dir / ".env", repo_root / ".env"]:
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
        break
else:
    load_dotenv()

POWERBI_PUSH_URL = os.getenv("POWERBI_PUSH_URL", "").strip()
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://127.0.0.1:8001").rstrip("/")
BATCH_SIZE = int(os.getenv("PBI_BATCH_SIZE", "50"))
INTERVAL_SECONDS = float(os.getenv("PBI_INTERVAL_SECONDS", "1.0"))
MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 1.0

# Whitelisted fields strictly required by the Power BI dataset
ALLOWED_FIELDS = [
    "txn_id",
    "timestamp",
    "account_id",
    "merchant",
    "amount",
    "region",
    "channel",
    "risk_score",
]

# ---------------------------------------------------------------------------
# Logging Setup (writes to logs/sender.log and stdout)
# ---------------------------------------------------------------------------

# Determine log directory (relative to current working directory or script dir)
log_dir = Path("logs").resolve()
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / "sender.log"

logger = logging.getLogger("sentinel.pbi_sender")
logger.setLevel(logging.INFO)

formatter = logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# File handler -> logs/sender.log
file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
file_handler.setFormatter(formatter)
file_handler.setLevel(logging.INFO)
logger.addHandler(file_handler)

# Stream handler -> stdout
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(formatter)
stream_handler.setLevel(logging.INFO)
logger.addHandler(stream_handler)


# ---------------------------------------------------------------------------
# In-process generator fallback (if simulator API server is offline)
# ---------------------------------------------------------------------------

_local_simulator = None

def get_local_simulator():
    global _local_simulator
    if _local_simulator is None:
        try:
            from txn_generator import TransactionSimulator
            _local_simulator = TransactionSimulator()
        except ImportError:
            sys.path.insert(0, str(script_dir))
            from txn_generator import TransactionSimulator
            _local_simulator = TransactionSimulator()
    return _local_simulator


# ---------------------------------------------------------------------------
# Data Ingestion Helpers
# ---------------------------------------------------------------------------

def fetch_transactions_from_api(limit: int) -> List[Dict[str, Any]]:
    """Try to pull up to `limit` transactions from running simulator API."""
    try:
        resp = requests.get(f"{SIMULATOR_URL}/batch?limit={limit}", timeout=1.5)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                return data
    except (requests.RequestException, ValueError):
        pass
    return []


def generate_local_transactions(count: int) -> List[Dict[str, Any]]:
    """Generate transactions locally when standalone or API buffer is dry."""
    sim = get_local_simulator()
    txns = []
    for _ in range(count):
        t = sim.create_transaction()
        txns.append(t.to_dict())
    return txns


def filter_transaction(txn: Dict[str, Any]) -> Dict[str, Any]:
    """Filter transaction strictly to the specified Power BI fields."""
    return {k: txn[k] for k in ALLOWED_FIELDS if k in txn}


# ---------------------------------------------------------------------------
# Power BI Dispatcher with 5x Retry Logic
# ---------------------------------------------------------------------------

def send_batch_to_powerbi(batch: List[Dict[str, Any]]) -> bool:
    """
    Sends a batch of transactions to Power BI via HTTP POST.
    Retries up to MAX_RETRIES (5 times) on network or server error.
    Returns True if sent successfully, False otherwise.
    """
    if not POWERBI_PUSH_URL:
        logger.error("[FAILURE] POWERBI_PUSH_URL is not configured in .env")
        return False

    if not batch:
        return True

    payload = json.dumps(batch)
    headers = {"Content-Type": "application/json"}

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            t0 = time.perf_counter()
            response = requests.post(
                POWERBI_PUSH_URL,
                data=payload,
                headers=headers,
                timeout=10.0,
            )
            elapsed = time.perf_counter() - t0

            if response.status_code in (200, 201, 202):
                logger.info(
                    f"[SUCCESS] Sent {len(batch)} transactions to Power BI "
                    f"(HTTP {response.status_code}, latency: {elapsed:.2f}s)"
                )
                return True
            else:
                err_text = response.text[:200]
                logger.warning(
                    f"[RETRY {attempt}/{MAX_RETRIES}] Power BI returned HTTP {response.status_code}: {err_text}"
                )

        except requests.RequestException as exc:
            logger.warning(
                f"[RETRY {attempt}/{MAX_RETRIES}] Connection error: {exc}"
            )

        if attempt < MAX_RETRIES:
            sleep_sec = RETRY_BACKOFF_BASE * attempt
            time.sleep(sleep_sec)

    logger.error(
        f"[FAILURE] Failed to send batch of {len(batch)} transactions after {MAX_RETRIES} retries."
    )
    return False


# ---------------------------------------------------------------------------
# Main Loop
# ---------------------------------------------------------------------------

def run_sender():
    logger.info("=" * 60)
    logger.info("SENTINEL Power BI Sender started")
    logger.info(f"Target Push URL : {POWERBI_PUSH_URL[:45]}..." if POWERBI_PUSH_URL else "No URL set")
    logger.info(f"Batch size      : {BATCH_SIZE} transactions")
    logger.info(f"Send interval   : {INTERVAL_SECONDS}s")
    logger.info(f"Log output      : {log_file}")
    logger.info("=" * 60)

    if not POWERBI_PUSH_URL:
        logger.error("[ERROR] POWERBI_PUSH_URL is missing. Please set it in .env before running.")
        sys.exit(1)

    total_sent = 0
    total_failed = 0

    try:
        while True:
            start_time = time.monotonic()

            # 1. Fetch transactions (from simulator API first, else fallback generator)
            raw_txns = fetch_transactions_from_api(limit=BATCH_SIZE)
            if not raw_txns:
                raw_txns = generate_local_transactions(count=BATCH_SIZE)

            # 2. Filter strictly to allowed fields
            clean_batch = [filter_transaction(t) for t in raw_txns][:BATCH_SIZE]

            # 3. Send batch with retries
            success = send_batch_to_powerbi(clean_batch)
            if success:
                total_sent += len(clean_batch)
            else:
                total_failed += len(clean_batch)

            # 4. Sleep to maintain exactly 1-second interval
            elapsed = time.monotonic() - start_time
            sleep_time = max(0.0, INTERVAL_SECONDS - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        logger.info(
            f"Sender stopped by user. Total sent: {total_sent}, Total failed: {total_failed}."
        )


if __name__ == "__main__":
    run_sender()
