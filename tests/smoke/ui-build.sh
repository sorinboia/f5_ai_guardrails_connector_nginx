#!/usr/bin/env bash
set -euo pipefail

# Smoke build for the React management UI. Builds the SPA, copies assets into html/ (via root script),
# boots the Node management listener on an isolated port, and curls the UI routes to ensure the SPA
# is served with the expected fallback behaviour.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CONFIG_STORE_PATH="${CONFIG_STORE_PATH:-$(mktemp -t guardrails-ui-store-XXXX.json)}"
MANAGEMENT_PORT="${MANAGEMENT_PORT:-23100}"
HTTP_PORT="${HTTP_PORT:-23080}"
HTTPS_PORT="${HTTPS_PORT:-23443}"
LOG_FILE="${LOG_FILE:-/tmp/guardrails-ui-smoke.log}"

SERVER_PID=""
CLEAN_STORE="1"

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${CLEAN_STORE}" && -f "${CONFIG_STORE_PATH}" ]]; then
    rm -f "${CONFIG_STORE_PATH}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"

echo "[ui-smoke] building UI and syncing assets to html/"
npm run build:ui >/dev/null

echo "[ui-smoke] starting management listener on port ${MANAGEMENT_PORT} (http ${HTTP_PORT}, https ${HTTPS_PORT})"
cd "${ROOT_DIR}/node"
MANAGEMENT_PORT="${MANAGEMENT_PORT}" \
HTTP_PORT="${HTTP_PORT}" \
HTTPS_PORT="${HTTPS_PORT}" \
FORWARD_PROXY_ENABLED="false" \
BACKEND_ORIGIN="http://127.0.0.1:18080" \
LOG_LEVEL="warn" \
CONFIG_STORE_PATH="${CONFIG_STORE_PATH}" \
node src/server.js >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!
cd "${ROOT_DIR}"

sleep 0.2

echo "[ui-smoke] waiting for management UI to respond"
for _ in {1..50}; do
  if curl -sf "http://127.0.0.1:${MANAGEMENT_PORT}/config/ui" >/dev/null; then
    break
  fi
  sleep 0.2
done

if ! curl -sf "http://127.0.0.1:${MANAGEMENT_PORT}/config/ui" | grep -qi "<!doctype"; then
  echo "[ui-smoke] /config/ui did not return SPA shell; logs: ${LOG_FILE}" >&2
  exit 1
fi

if ! curl -sf "http://127.0.0.1:${MANAGEMENT_PORT}/config/ui/patterns" | grep -qi "<!doctype"; then
  echo "[ui-smoke] SPA fallback failed for nested route /config/ui/patterns" >&2
  exit 1
fi

echo "[ui-smoke] success — UI shell served for base and nested routes"
