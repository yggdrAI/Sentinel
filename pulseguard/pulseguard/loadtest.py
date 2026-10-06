from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pulseguard.config import get_settings
from pulseguard.db import Database
from pulseguard.engine import Pipeline


def main() -> None:
    parser = argparse.ArgumentParser(description="PulseGuard in-process load test")
    parser.add_argument("--eps", type=int, default=2000)
    parser.add_argument("--seconds", type=float, default=3.0)
    args = parser.parse_args()
    settings = get_settings()
    db = Database(settings.db_path)
    pipe = Pipeline(settings=settings, db=db)
    result = pipe.load_test(args.eps, args.seconds)
    print(json.dumps(result.model_dump(), indent=2))
    db.close()


if __name__ == "__main__":
    main()
