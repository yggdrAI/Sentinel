from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import os

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT / ".env", ROOT / ".env.example"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_host: str = "127.0.0.1"
    api_port: int = 8080
    dashboard_port: int = 8501
    api_base_url: str = "http://127.0.0.1:8080"
    database_path: str = "data/pulseguard.db"
    log_level: str = "INFO"
    simulator_enabled: bool = True
    simulator_eps: float = 12.0

    amount_threshold: float = 2500.0
    decline_rate_threshold: float = 0.18
    risk_score_threshold: float = 82.0
    velocity_txn_per_min: int = 12
    high_risk_merchant_share_threshold: float = 0.12
    freshness_sla_seconds: float = 5.0

    azure_eventhub_enabled: bool = False
    azure_eventhub_connection_string: str = ""
    azure_eventhub_name: str = ""
    azure_eventhub_batch_size: int = 20

    @property
    def db_path(self) -> Path:
        path = Path(self.database_path)
        if not path.is_absolute():
            path = ROOT / path
            # SQLite WAL is unreliable on OneDrive-synced folders.
            if "onedrive" in str(ROOT).lower():
                base = Path(os.getenv("LOCALAPPDATA", str(Path.home() / ".pulseguard"))) / "PulseGuard"
                base.mkdir(parents=True, exist_ok=True)
                return base / path.name
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
