#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the Node proxy against local stub servers (backend + Guardrails).
# Spins up everything on alternate ports so it can run alongside NGINX.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT/node"
LOG_DIR="${LOG_DIR:-$(mktemp -d /tmp/node-shadow-XXXX)}"
HTTP_PORT="${HTTP_PORT:-21434}"
BACKEND_PORT="${BACKEND_PORT:-18080}"
GUARDRAILS_PORT="${GUARDRAILS_PORT:-18081}"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://127.0.0.1:${BACKEND_PORT}}"
SIDEBAND_URL="${SIDEBAND_URL:-http://127.0.0.1:${GUARDRAILS_PORT}/backend/v1/scans}"
STORE_PATH="${CONFIG_STORE_PATH:-$(mktemp -t guardrails_store.XXXX.json)}"
STORE_TMP_CREATED=1
if [[ -n "${CONFIG_STORE_PATH:-}" ]]; then
  STORE_TMP_CREATED=0
fi

cat >"$STORE_PATH" <<EOF
{
  "version": 1,
  "hosts": ["__default__"],
  "hostConfigs": {
    "__default__": {
      "inspectMode": "both",
      "redactMode": "both",
      "logLevel": "debug",
      "requestForwardMode": "sequential",
      "backendOrigin": "${BACKEND_ORIGIN}",
      "requestExtractors": ["pat_req"],
      "responseExtractors": ["pat_resp"],
      "extractorParallel": false,
      "responseStreamEnabled": true,
      "responseStreamChunkSize": 512,
      "responseStreamChunkOverlap": 64,
      "responseStreamFinalEnabled": true,
      "responseStreamCollectFullEnabled": false
    }
  },
  "apiKeys": [
    {
      "id": "ak_shadow",
      "name": "shadow-key",
      "key": "shadow-bearer",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z",
      "blockingResponse": {
        "status": 403,
        "contentType": "application/json",
        "body": "{\"blocked\":true}"
      }
    }
  ],
  "patterns": [
    { "id": "pat_req", "context": "request", "name": "req-default", "apiKeyName": "shadow-key", "paths": [".messages[-1].content"], "matchers": [] },
    { "id": "pat_resp", "context": "response", "name": "resp-default", "apiKeyName": "shadow-key", "paths": [".message.content"], "matchers": [] }
  ],
  "collector": { "entries": [], "total": 0, "remaining": 0 }
}
EOF

cleanup() {
  [[ -n "${NODE_PID:-}" ]] && kill "$NODE_PID" >/dev/null 2>&1 || true
  [[ -n "${STUB_PID:-}" ]] && kill "$STUB_PID" >/dev/null 2>&1 || true
  if [[ $STORE_TMP_CREATED -eq 1 ]]; then
    rm -f "$STORE_PATH"
  fi
}
trap cleanup EXIT

echo "Starting stub servers on ${BACKEND_PORT}/${GUARDRAILS_PORT}..."
(
  BACKEND_PORT="$BACKEND_PORT" GUARDRAILS_PORT="$GUARDRAILS_PORT" \
    python3 "$ROOT/tests/servers/stub_servers.py" >"$LOG_DIR/stubs.log" 2>&1
) &
STUB_PID=$!

echo "Starting Node proxy on ${HTTP_PORT} (logs: $LOG_DIR/node.log)..."
(
  cd "$NODE_DIR"
  HTTP_PORT="$HTTP_PORT" BACKEND_ORIGIN="$BACKEND_ORIGIN" SIDEBAND_URL="$SIDEBAND_URL" \
    CONFIG_STORE_PATH="$STORE_PATH" LOG_LEVEL="${LOG_LEVEL:-debug}" \
    node src/server.js >"$LOG_DIR/node.log" 2>&1
) &
NODE_PID=$!

for _ in $(seq 1 50); do
  if (echo >"/dev/tcp/127.0.0.1/${HTTP_PORT}") >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! (echo >"/dev/tcp/127.0.0.1/${HTTP_PORT}") >/dev/null 2>&1; then
  echo "Node proxy failed to start; see $LOG_DIR/node.log"
  exit 1
fi

curl_json() {
  local name="$1"
  local body="$2"
  local path="${3:-/api/chat}"
  local outfile="$LOG_DIR/${name}.json"
  local status
  status=$(curl -sS -o "$outfile" -w "%{http_code}" \
    -H "Host: tests.local" \
    -H "content-type: application/json" \
    --data "$body" \
    "http://127.0.0.1:${HTTP_PORT}${path}")
  echo "$status" "$outfile"
}

pass_status=$(curl_json "pass_through" '{"messages":[{"role":"user","content":"hello shadow"}]}')
pass_code=${pass_status%% *}; pass_path=${pass_status#* }

block_status=$(curl_json "blocked" '{"messages":[{"role":"user","content":"BLOCK_ME please"}]}')
block_code=${block_status%% *}; block_path=${block_status#* }

redact_status=$(curl_json "redacted" '{"messages":[{"role":"user","content":"Please REDACT_ME secret"}]}')
redact_code=${redact_status%% *}; redact_path=${redact_status#* }

stream_status=$(curl_json "stream_flag" '{"messages":[{"role":"user","content":"stream please"}]}' "/api/stream")
stream_code=${stream_status%% *}; stream_path=${stream_status#* }

echo "---- Results ----"
if [[ $pass_code == "200" && $(grep -c "hello shadow" "$pass_path" || true) -ge 1 ]]; then
  echo "PASS pass-through (200)"
else
  echo "FAIL pass-through (status $pass_code) see $pass_path"
fi

if [[ $block_code == "403" && $(grep -c "blocked" "$block_path" || true) -ge 1 ]]; then
  echo "PASS block (403)"
else
  echo "FAIL block (status $block_code) see $block_path"
fi

if [[ $redact_code == "200" && $(grep -c "REDACT_ME" "$redact_path" || true) -eq 0 ]]; then
  echo "PASS redaction (masked payload forwarded)"
else
  echo "FAIL redaction (status $redact_code) see $redact_path"
fi

if [[ $stream_code == "403" ]]; then
  echo "PASS stream flagging (403)"
else
  echo "FAIL stream flagging (status $stream_code) see $stream_path"
fi

echo "Logs at: $LOG_DIR"
