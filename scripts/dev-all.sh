#!/usr/bin/env bash
set -euo pipefail

# Start both the Node backend and the React UI dev server.
# Logs are written to /tmp by default; override BACKEND_LOG/UI_LOG if needed.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_LOG="${BACKEND_LOG:-/tmp/guardrails-backend.log}"
UI_LOG="${UI_LOG:-/tmp/guardrails-ui.log}"

cd "${ROOT_DIR}"

echo "[dev-all] starting backend (management:22100, http:22080, https:22443)"
UI_DEV_ORIGIN="${UI_DEV_ORIGIN:-http://localhost:5173}" \
  npm run dev --prefix node >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!

echo "[dev-all] starting UI dev server (Vite on 5173)"
npm run dev --prefix ui >"${UI_LOG}" 2>&1 &
UI_PID=$!

echo "[dev-all] backend PID=${BACKEND_PID} log=${BACKEND_LOG}"
echo "[dev-all] ui PID=${UI_PID} log=${UI_LOG}"
echo "Press Ctrl+C to stop both."

cleanup() {
  kill "${BACKEND_PID}" "${UI_PID}" 2>/dev/null || true
}
trap cleanup INT TERM

wait "${BACKEND_PID}" "${UI_PID}"
