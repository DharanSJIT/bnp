import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # noqa: BLE001
    pass

MONGO_URI = os.environ.get("ONERECON_MONGO_URI") or os.environ.get("MONGO_URI") or "mongodb://127.0.0.1:27017/onerecon"
DB_NAME = os.environ.get("ONERECON_DB") or "onerecon"