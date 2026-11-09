#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
node scripts/build-worker.mjs
exec node local/server.mjs
