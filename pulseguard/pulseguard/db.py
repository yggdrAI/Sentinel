from __future__ import annotations

import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

_SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE NOT NULL,
  ts REAL NOT NULL,
  account_id TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount REAL NOT NULL,
  country TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_score REAL NOT NULL,
  high_risk INTEGER NOT NULL DEFAULT 0,
  processed_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_ts ON transactions(ts DESC);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id, ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT UNIQUE NOT NULL,
  created_at REAL NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  entity TEXT NOT NULL,
  value REAL NOT NULL,
  threshold REAL NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  acknowledged_at REAL,
  resolved_at REAL
);
CREATE INDEX IF NOT EXISTS idx_alert_status ON alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_fp ON alerts(fingerprint, status);

CREATE TABLE IF NOT EXISTS kpi_points (
  ts REAL PRIMARY KEY,
  tps REAL NOT NULL,
  decline_rate REAL NOT NULL,
  avg_risk REAL NOT NULL,
  avg_amount REAL NOT NULL,
  high_risk_share REAL NOT NULL,
  active_alerts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS perf_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at REAL NOT NULL,
  target_eps INTEGER NOT NULL,
  duration_s REAL NOT NULL,
  actual_eps REAL NOT NULL,
  p50_ms REAL NOT NULL,
  p95_ms REAL NOT NULL,
  p99_ms REAL NOT NULL,
  success_rate REAL NOT NULL,
  events INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(path),
            check_same_thread=False,
            isolation_level=None,
        )
        self._conn.row_factory = sqlite3.Row
        self._setup()

    def _setup(self) -> None:
        with self._lock:
            self._conn.executescript(_SCHEMA)

    @contextmanager
    def cursor(self) -> Iterator[sqlite3.Cursor]:
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
            finally:
                cur.close()

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self.cursor() as cur:
            return cur.execute(sql, params)

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        with self.cursor() as cur:
            cur.executemany(sql, rows)

    def fetchall(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self.cursor() as cur:
            return cur.execute(sql, params).fetchall()

    def fetchone(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        with self.cursor() as cur:
            return cur.execute(sql, params).fetchone()

    def prune(self, older_than_seconds: float = 900) -> None:
        cutoff = time.time() - older_than_seconds
        with self.cursor() as cur:
            cur.execute("DELETE FROM transactions WHERE ts < ?", (cutoff,))
            cur.execute("DELETE FROM kpi_points WHERE ts < ?", (cutoff,))
            cur.execute(
                "DELETE FROM alerts WHERE status = 'RESOLVED' AND created_at < ?",
                (cutoff,),
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()
