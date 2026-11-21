#!/usr/bin/env bash
# LegalMind AI - one-time local setup for macOS / Linux (no Docker needed).
set -euo pipefail
cd "$(dirname "$0")/.."

PY=""
for c in python3.11 python3.12 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    v=$("$c" -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
    if [[ "$v" == "3.11" || "$v" == "3.12" ]]; then PY="$c"; break; fi
  fi
done
[[ -z "$PY" ]] && { echo "Python 3.11 or 3.12 is required"; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ is required"; exit 1; }

if [[ ! -f .env ]]; then
  secret=$($PY -c 'import secrets;print(secrets.token_urlsafe(36))')
  sed "s|^JWT_SECRET=.*|JWT_SECRET=$secret|" .env.example > .env
  echo ".env created - add your GEMINI_API_KEY (https://aistudio.google.com/apikey)"
fi

[[ -d backend/.venv ]] || $PY -m venv backend/.venv
backend/.venv/bin/pip install --upgrade pip -q
backend/.venv/bin/pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
backend/.venv/bin/pip install -r backend/requirements-dev.txt
(cd frontend && npm ci --no-audit --no-fund)
backend/.venv/bin/python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; SentenceTransformer('BAAI/bge-small-en-v1.5'); CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2'); print('models ready')"
echo "Setup complete. Start with: ./scripts/start.sh"
