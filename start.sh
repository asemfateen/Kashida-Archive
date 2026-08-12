#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export NODE_ENV="${NODE_ENV:-production}"

echo "[start] installing server deps"
(cd server && npm ci --omit=dev --silent)

echo "[start] applying database schema"
(cd server && npm run db:init)

if [ ! -d "client/dist" ]; then
  echo "[start] building client"
  (cd client && npm ci --silent && npm run build)
fi

echo "[start] launching API"
cd server
exec node src/index.js