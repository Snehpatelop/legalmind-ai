#!/usr/bin/env bash
# LegalMind AI - start backend + frontend locally (macOS / Linux). Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -x backend/.venv/bin/python ]] || { echo "Run ./scripts/setup.sh first"; exit 1; }
(cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACK=$!
(cd frontend && npm run dev) &
FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null' EXIT INT TERM
echo "Backend: http://127.0.0.1:8000/docs   Frontend: http://localhost:5173"
wait
