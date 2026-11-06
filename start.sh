#!/usr/bin/env bash
# Запуск Cloud_UI: бэкенд + собранный фронтенд на http://127.0.0.1:8188
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/home/nik/.local/opt/node-v26.13.0-linux-x64/bin:$PATH"

if [ ! -d frontend/dist ]; then
  echo "[cloud-ui] building frontend…"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi

exec python3 backend/server.py
