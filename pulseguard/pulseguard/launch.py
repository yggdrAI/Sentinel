from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent


def ensure_env() -> None:
    env = ROOT / ".env"
    example = ROOT / ".env.example"
    if not env.exists() and example.exists():
        env.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")


def wait_healthy(url: str, timeout: float = 25.0) -> None:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"{url}/health", timeout=1.5)
            if r.status_code == 200 and r.json().get("ok"):
                return
            last = r.text
        except Exception as exc:
            last = str(exc)
        time.sleep(0.25)
    raise SystemExit(f"API failed to become healthy at {url}: {last}")


def main() -> None:
    ensure_env()
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from pulseguard.config import get_settings

    settings = get_settings()
    host = settings.api_host
    port = settings.api_port
    dash_port = settings.dashboard_port
    api_url = f"http://{host}:{port}"
    dashboard = ROOT / "dashboard.py"

    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    env.setdefault("API_BASE_URL", api_url)

    api = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "pulseguard.api:app",
            "--host",
            host,
            "--port",
            str(port),
            "--log-level",
            "info",
        ],
        cwd=str(ROOT),
        env=env,
    )
    dash = None
    try:
        wait_healthy(api_url)
        dash = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "streamlit",
                "run",
                str(dashboard),
                "--server.port",
                str(dash_port),
                "--server.headless",
                "true",
                "--browser.gatherUsageStats",
                "false",
            ],
            cwd=str(ROOT),
            env=env,
        )
        print(f"PulseGuard API        {api_url}", flush=True)
        print(f"PulseGuard dashboard  http://127.0.0.1:{dash_port}", flush=True)
        print("Ctrl+C to stop.", flush=True)
        while True:
            if api.poll() is not None:
                raise SystemExit(f"API exited with {api.returncode}")
            if dash.poll() is not None:
                raise SystemExit(f"Dashboard exited with {dash.returncode}")
            time.sleep(0.4)
    except KeyboardInterrupt:
        print("\nShutting down PulseGuard.")
    finally:
        for proc in (dash, api):
            if proc is not None and proc.poll() is None:
                proc.terminate()
        time.sleep(0.4)
        for proc in (dash, api):
            if proc is not None and proc.poll() is None:
                proc.kill()
