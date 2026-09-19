#!/usr/bin/env bash
# OneRecon dev orchestrator — starts everything needed for the demo.
# Usage: bash scripts/dev_all.sh [month]   (month default: august; other: june|july)
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONTH="${1:-august}"
MONTH_CC="$(echo "$MONTH" | sed -E 's/^(june|july|august)$/2026\1/')"  # not used — keep folder name
MONTH_PATH="$ROOT/Current Data/$MONTH"
if [ ! -f "$MONTH_PATH/ma_api_server_*.py" ]; then MONTH_PATH="$ROOT/Historical Data/$MONTH"; fi

port_free() { ! lsof -i ":$1" >/dev/null 2>&1; }

say() { printf '\033[1;34m[OneRecon]\033[0m %s\n' "$*"; }

# 1. MongoDB
if port_free 27017; then
  say "starting MongoDB (data dir .mongo-data)"
  mkdir -p "$ROOT/.mongo-data"
  (mongod --dbpath "$ROOT/.mongo-data" --port 27017 --bind_ip 127.0.0.1 >/dev/null 2>&1 &)
  sleep 2
else
  say "MongoDB already on :27017"
fi

# 2. MA server (port 5001 — macOS reserves 5000)
if port_free 5001; then
  MA_FILE=$(ls "$MONTH_PATH"/ma_api_server_*.py | head -1)
  say "starting MA server: $MA_FILE on :5001"
  (cd "$ROOT" && python3 ai-service/.venv/bin/python scripts/start_ma_server.py "$MA_FILE" >/tmp/onerecon_ma.log 2>&1 &)
  sleep 3
else
  say "MA server already on :5001"
fi

# 3. AI service
if port_free 8000; then
  say "starting AI service on :8000"
  (cd "$ROOT/ai-service" && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >/tmp/onerecon_ai.log 2>&1 &)
  sleep 2
else
  say "AI service already on :8000"
fi

# 4. Backend
if port_free 4000; then
  say "starting backend on :4000"
  (cd "$ROOT/backend" && node src/server.js >/tmp/onerecon_backend.log 2>&1 &)
  sleep 2
else
  say "backend already on :4000"
fi

# 5. Frontend
if port_free 5173; then
  say "starting frontend on :5173"
  (cd "$ROOT/frontend" && npm run dev >/tmp/onerecon_frontend.log 2>&1 &)
  sleep 4
else
  say "frontend already on :5173"
fi

say "done. Open http://127.0.0.1:5173  (logs: /tmp/onerecon_*.log)"