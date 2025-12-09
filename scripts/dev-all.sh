#!/usr/bin/env bash
set -euo pipefail

# Start both the Node backend and the React UI dev server.
# Logs are written to /tmp by default; override BACKEND_LOG/UI_LOG if needed.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_LOG="${BACKEND_LOG:-/tmp/guardrails-backend.log}"
UI_LOG="${UI_LOG:-/tmp/guardrails-ui.log}"

# Reset log files so tail starts from fresh content.
: >"${BACKEND_LOG}"
: >"${UI_LOG}"

cd "${ROOT_DIR}"

echo "[dev-all] starting backend (management:22100, http:22080, https:22443)"
UI_DEV_ORIGIN="${UI_DEV_ORIGIN:-http://localhost:5173}" \
  npm run dev --prefix node >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!
tail -n0 -f "${BACKEND_LOG}" &
BACKEND_TAIL_PID=$!

echo "[dev-all] starting UI dev server (Vite on 5173)"
npm run dev --prefix ui >"${UI_LOG}" 2>&1 &
UI_PID=$!
tail -n0 -f "${UI_LOG}" &
UI_TAIL_PID=$!

echo "[dev-all] backend PID=${BACKEND_PID} log=${BACKEND_LOG} (streaming to stdout)"
echo "[dev-all] ui PID=${UI_PID} log=${UI_LOG} (streaming to stdout)"
echo "Press Ctrl+C to stop both."

cleanup() {
  kill "${BACKEND_PID}" "${UI_PID}" "${BACKEND_TAIL_PID:-}" "${UI_TAIL_PID:-}" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

wait "${BACKEND_PID}" "${UI_PID}"
