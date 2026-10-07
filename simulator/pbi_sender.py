"""
simulator/pbi_sender.py
=======================
Consumes transactions from the SENTINEL simulator, sends them
to the Power BI Streaming Dataset Push URL, runs a threshold
detector that pushes high-risk transaction alerts to FLOW_ALERT_URL,
and persists transactions and alerts to Azure SQL in batches.

Specifications:
  - Sends every 1 second, up to 50 transactions per batch to Power BI.
  - Whitelist filter: ONLY sends [txn_id, timestamp, account_id, merchant,
    amount, region, channel, risk_score] to Power BI.
  - On failure to Power BI, retries up to 5 times.
  - Threshold Detector:
      * risk_score > 80: triggers alert JSON (account_id, amount, risk_score, severity, reason)
      * severity: "warning" if 80 < risk_score <= 90; "critical" if risk_score > 90
      * Cooldown: Max 1 alert per account per minute (60 seconds)
      * Dispatches to FLOW_ALERT_URL from .env
      * Logs every alert to logs/alerts.log
  - Azure SQL persistence:
      * Saves transactions and triggered alerts to Azure SQL using AZURE_SQL_CONN from .env
      * Creates tables 'transactions' and 'alerts' if they don't exist, with 'ingest_latency_ms' column
      * Inserts in batches
      * If Azure is unreachable, logs the error and keeps the sender running
  - Logs sender batches to logs/sender.log.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

# Try importing pyodbc safely
try:
    import pyodbc
except ImportError:
    pyodbc = None

# ---------------------------------------------------------------------------
# Load Configuration
# ---------------------------------------------------------------------------

script_dir = Path(__file__).resolve().parent
repo_root = script_dir.parent
for env_path in [script_dir / ".env", repo_root / ".env"]:
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
        break
else:
    load_dotenv()

POWERBI_PUSH_URL = os.getenv("POWERBI_PUSH_URL", "").strip()
FLOW_ALERT_URL = (os.getenv("FLOW_ALERT_URL") or os.getenv("POWER_AUTOMATE_WEBHOOK_URL") or "").strip()
AZURE_SQL_CONN = os.getenv("AZURE_SQL_CONN", "").strip()
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://127.0.0.1:8001").rstrip("/")
BATCH_SIZE = int(os.getenv("PBI_BATCH_SIZE", "50"))
INTERVAL_SECONDS = float(os.getenv("PBI_INTERVAL_SECONDS", "1.0"))
MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 1.0

# Cooldown for threshold alerts: 1 alert per account per 60 seconds
ALERT_COOLDOWN_SECONDS = 60.0
_account_alert_cooldown: Dict[str, float] = {}

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
# Logging Setup
# ---------------------------------------------------------------------------

log_dir = Path("logs").resolve()
log_dir.mkdir(parents=True, exist_ok=True)

sender_log_file = log_dir / "sender.log"
alert_log_file = log_dir / "alerts.log"

formatter = logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# 1. Main Sender Logger -> logs/sender.log and stdout
logger = logging.getLogger("sentinel.pbi_sender")
logger.setLevel(logging.INFO)

file_handler = logging.FileHandler(str(sender_log_file), encoding="utf-8")
file_handler.setFormatter(formatter)
file_handler.setLevel(logging.INFO)
logger.addHandler(file_handler)

stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(formatter)
stream_handler.setLevel(logging.INFO)
logger.addHandler(stream_handler)

# 2. Alert Logger -> logs/alerts.log and stdout
alert_logger = logging.getLogger("sentinel.alerts")
alert_logger.setLevel(logging.INFO)

alert_file_handler = logging.FileHandler(str(alert_log_file), encoding="utf-8")
alert_file_handler.setFormatter(formatter)
alert_file_handler.setLevel(logging.INFO)
alert_logger.addHandler(alert_file_handler)

alert_stream_handler = logging.StreamHandler(sys.stdout)
alert_stream_handler.setFormatter(formatter)
alert_stream_handler.setLevel(logging.INFO)
alert_logger.addHandler(alert_stream_handler)


# ---------------------------------------------------------------------------
# Azure SQL Connection & Table Management
# ---------------------------------------------------------------------------

_azure_db_conn = None
_azure_tables_verified = False


def get_azure_db_connection():
    """Retrieve or establish Azure SQL connection using pyodbc."""
    global _azure_db_conn
    if not AZURE_SQL_CONN:
        return None

    if pyodbc is None:
        logger.error("[AZURE_SQL_ERROR] pyodbc is not installed. Run 'pip install pyodbc'.")
        return None

    if _azure_db_conn is not None:
        try:
            cursor = _azure_db_conn.cursor()
            cursor.execute("SELECT 1")
            return _azure_db_conn
        except Exception:
            _azure_db_conn = None

    try:
        _azure_db_conn = pyodbc.connect(AZURE_SQL_CONN, timeout=10)
        return _azure_db_conn
    except Exception as exc:
        logger.error(f"[AZURE_SQL_ERROR] Failed to connect to Azure SQL: {exc}")
        _azure_db_conn = None
        return None


def ensure_azure_tables(conn) -> bool:
    """Creates tables 'transactions' and 'alerts' if they don't exist, ensuring ingest_latency_ms column."""
    global _azure_tables_verified
    if _azure_tables_verified:
        return True

    try:
        cursor = conn.cursor()

        # 1. Transactions table
        cursor.execute("""
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'transactions')
            BEGIN
                CREATE TABLE transactions (
                    txn_id VARCHAR(64) NOT NULL PRIMARY KEY,
                    timestamp VARCHAR(64) NOT NULL,
                    account_id VARCHAR(64) NOT NULL,
                    merchant VARCHAR(128) NOT NULL,
                    amount FLOAT NOT NULL,
                    region VARCHAR(64) NOT NULL,
                    channel VARCHAR(64) NOT NULL,
                    risk_score FLOAT NOT NULL,
                    ingest_latency_ms FLOAT NULL,
                    created_at DATETIME2 DEFAULT SYSUTCDATETIME()
                );
            END
            ELSE
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('transactions') AND name = 'ingest_latency_ms')
                BEGIN
                    ALTER TABLE transactions ADD ingest_latency_ms FLOAT NULL;
                END
            END
        """)

        # 2. Alerts table
        cursor.execute("""
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'alerts')
            BEGIN
                CREATE TABLE alerts (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    account_id VARCHAR(64) NOT NULL,
                    amount FLOAT NOT NULL,
                    risk_score FLOAT NOT NULL,
                    severity VARCHAR(32) NOT NULL,
                    reason VARCHAR(512) NOT NULL,
                    created_at VARCHAR(64) NULL,
                    ingest_latency_ms FLOAT NULL
                );
            END
            ELSE
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('alerts') AND name = 'ingest_latency_ms')
                BEGIN
                    ALTER TABLE alerts ADD ingest_latency_ms FLOAT NULL;
                END
            END
        """)

        conn.commit()
        _azure_tables_verified = True
        logger.info("[AZURE_SQL] Verified tables: 'transactions' and 'alerts' (with ingest_latency_ms)")
        return True
    except Exception as exc:
        logger.error(f"[AZURE_SQL_ERROR] Table verification failed: {exc}")
        return False


def save_to_azure_sql(transactions: List[Dict[str, Any]], alerts: List[Dict[str, Any]]) -> None:
    """
    Saves batches of transactions and alerts to Azure SQL.
    If Azure is unreachable, logs error and keeps sender running.
    """
    if not AZURE_SQL_CONN:
        return

    conn = get_azure_db_connection()
    if conn is None:
        return

    if not ensure_azure_tables(conn):
        return

    try:
        cursor = conn.cursor()

        # Batch insert transactions
        if transactions:
            txn_rows = []
            for t in transactions:
                latency = float(t.get("ingest_latency_ms") or t.get("ingestion_latency_ms") or 0.0)
                txn_rows.append((
                    str(t.get("txn_id", "")),
                    str(t.get("timestamp", "")),
                    str(t.get("account_id", "")),
                    str(t.get("merchant", "")),
                    float(t.get("amount", 0.0)),
                    str(t.get("region", "")),
                    str(t.get("channel", "")),
                    float(t.get("risk_score", 0.0)),
                    latency,
                ))

            insert_txn_sql = """
                INSERT INTO transactions (
                    txn_id, timestamp, account_id, merchant, amount,
                    region, channel, risk_score, ingest_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            try:
                cursor.fast_executemany = True
            except Exception:
                pass
            cursor.executemany(insert_txn_sql, txn_rows)

        # Batch insert alerts
        if alerts:
            alert_rows = []
            for a in alerts:
                latency = float(a.get("ingest_latency_ms", 0.0))
                alert_rows.append((
                    str(a.get("account_id", "")),
                    float(a.get("amount", 0.0)),
                    float(a.get("risk_score", 0.0)),
                    str(a.get("severity", "")),
                    str(a.get("reason", "")),
                    str(a.get("created_at", "")),
                    latency,
                ))

            insert_alert_sql = """
                INSERT INTO alerts (
                    account_id, amount, risk_score, severity, reason,
                    created_at, ingest_latency_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """
            try:
                cursor.fast_executemany = True
            except Exception:
                pass
            cursor.executemany(insert_alert_sql, alert_rows)

        conn.commit()
        logger.info(
            f"[AZURE_SQL] Persisted {len(transactions)} transactions and {len(alerts)} alerts to database"
        )
    except Exception as exc:
        logger.error(f"[AZURE_SQL_ERROR] Failed to save batch to Azure SQL: {exc}")
        try:
            conn.rollback()
        except Exception:
            pass


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
# Threshold Detector & Alert Dispatcher
# ---------------------------------------------------------------------------

def check_and_send_alerts(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Scans transactions for risk_score > 80.
    Severity:
      - 'warning' if 80 < risk_score <= 90
      - 'critical' if risk_score > 90
    Throttling:
      - Does not alert the same account more than once per minute (60s).
    Sends alert JSON (account_id, amount, risk_score, severity, reason) to FLOW_ALERT_URL.
    Logs every alert to logs/alerts.log.
    Returns list of generated alert dictionaries for database storage.
    """
    triggered_alerts: List[Dict[str, Any]] = []

    for txn in transactions:
        try:
            risk_score = float(txn.get("risk_score", 0.0))
        except (ValueError, TypeError):
            continue

        if risk_score <= 80.0:
            continue

        account_id = str(txn.get("account_id", "UNKNOWN"))
        now = time.monotonic()
        last_alert_time = _account_alert_cooldown.get(account_id, 0.0)

        # Do not alert the same account more than once per minute
        if (now - last_alert_time) < ALERT_COOLDOWN_SECONDS:
            continue

        severity = "critical" if risk_score > 90.0 else "warning"
        amount = round(float(txn.get("amount", 0.0)), 2)
        reason = f"Transaction risk score of {risk_score:.1f} exceeded threshold 80.0 (severity: {severity})"
        now_iso = datetime.now(timezone.utc).isoformat()
        latency = float(txn.get("ingest_latency_ms") or txn.get("ingestion_latency_ms") or 0.0)

        alert_payload = {
            "account_id": account_id,
            "amount": amount,
            "risk_score": round(risk_score, 2),
            "severity": severity,
            "reason": reason,
            "created_at": now_iso,
            "ingest_latency_ms": latency,
        }

        # Mark cooldown timestamp
        _account_alert_cooldown[account_id] = now
        triggered_alerts.append(alert_payload)

        # Power Automate webhook dispatch
        dispatch_status = "NO_URL_CONFIGURED"
        if FLOW_ALERT_URL:
            try:
                # Include uppercase 'Severity' as well for case-insensitive flow compatibility
                webhook_body = {**alert_payload, "Severity": severity.upper()}
                resp = requests.post(
                    FLOW_ALERT_URL,
                    json=webhook_body,
                    headers={"Content-Type": "application/json"},
                    timeout=5.0,
                )
                dispatch_status = f"HTTP {resp.status_code}"
            except requests.RequestException as exc:
                dispatch_status = f"ERROR: {exc}"

        # Write alert to logs/alerts.log
        alert_logger.info(
            f"[ALERT:{severity.upper()}] account_id={account_id} amount={amount:.2f} "
            f"risk_score={risk_score:.1f} reason='{reason}' dispatch={dispatch_status}"
        )

    return triggered_alerts


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
    logger.info("SENTINEL Power BI Sender & Azure SQL Pipeline started")
    logger.info(f"Power BI URL   : {POWERBI_PUSH_URL[:45]}..." if POWERBI_PUSH_URL else "No URL set")
    logger.info(f"Flow Alert URL : {FLOW_ALERT_URL[:45]}..." if FLOW_ALERT_URL else "No alert URL set")
    logger.info(f"Azure SQL Conn : {'Configured' if AZURE_SQL_CONN else 'Not set (Azure SQL disabled)'}")
    logger.info(f"Batch size     : {BATCH_SIZE} transactions")
    logger.info(f"Send interval  : {INTERVAL_SECONDS}s")
    logger.info(f"Sender log     : {sender_log_file}")
    logger.info(f"Alert log      : {alert_log_file}")
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

            # 2. Check for high-risk threshold breaches & dispatch alerts
            triggered_alerts = check_and_send_alerts(raw_txns)

            # 3. Filter strictly to allowed Power BI fields
            clean_batch = [filter_transaction(t) for t in raw_txns][:BATCH_SIZE]

            # 4. Send batch to Power BI with retries
            success = send_batch_to_powerbi(clean_batch)
            if success:
                total_sent += len(clean_batch)
            else:
                total_failed += len(clean_batch)

            # 5. After sending each batch to Power BI, also save to Azure SQL
            save_to_azure_sql(raw_txns, triggered_alerts)

            # 6. Sleep to maintain exactly 1-second interval
            elapsed = time.monotonic() - start_time
            sleep_time = max(0.0, INTERVAL_SECONDS - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        logger.info(
            f"Sender stopped by user. Total sent: {total_sent}, Total failed: {total_failed}."
        )


if __name__ == "__main__":
    run_sender()
