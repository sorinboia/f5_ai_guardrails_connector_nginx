#!/usr/bin/env bash
set -euo pipefail
case_dir="$(cd "$(dirname "$0")" && pwd)"
INTEGRATION_DIR="$(cd "$case_dir/../.." && pwd)"
REPO_ROOT="$(cd "$INTEGRATION_DIR/../.." && pwd)"
source "$INTEGRATION_DIR/lib.sh"

CONFIG_PATH="$case_dir/config.json"
SERVER_SCRIPT="$case_dir/server.py"
TMP_DIR=$(mktemp -d)
LOG_FILE="$TMP_DIR/stub.log"
HOST_HEADER=$(python3 - "$CONFIG_PATH" <<'PY'
import json,sys, pathlib
cfg = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(cfg["host"])
PY
)

cleanup() { stop_stubs; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

start_stubs "$SERVER_SCRIPT" "$LOG_FILE"
reload_nginx
cleanup_entities "$HOST_HEADER"
create_api_keys "$HOST_HEADER"
create_patterns "$HOST_HEADER"
configure_host_from_file "$HOST_HEADER" "$CONFIG_PATH"

REQUEST="$REPO_ROOT/tests/fixtures/requests/block_chat.json"
OUT="$TMP_DIR/response.json"
LOG_CAPTURE="$TMP_DIR/log_capture.txt"

log_capture_start
status=$(run_curl "$HOST_HEADER" "$REQUEST" "/api/chat" "$OUT" -H "X-Sideband-Log: warn")
[[ "$status" == "451" ]] || { echo "Expected 451 with warn log override, got $status"; exit 1; }
log_capture_dump "$LOG_CAPTURE"

grep -q '"X-Sideband-Log":"warn"' "$LOG_CAPTURE" || { echo "Expected X-Sideband-Log header captured"; exit 1; }

echo "logging_level_override ok"

