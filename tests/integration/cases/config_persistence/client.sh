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

SNAPSHOT="$TMP_DIR/config_snapshot.json"

payload=$(python3 - <<'PY'
import json
print(json.dumps({
  "host": "persist.local",
  "config": {
    "backendOrigin": "http://127.0.0.1:18080",
    "inspectMode": "both"
  },
  "requestExtractors": [],
  "responseExtractors": []
}))
PY
)

curl -sS -X POST   -H "Host: ${HOST_HEADER}"   -H "Content-Type: application/json"   -H "X-Guardrails-Config-Host: persist.local"   --data "$payload"   "${API_BASE}/config/api" >/dev/null

curl_json "$HOST_HEADER" GET "/config/api" > "$SNAPSHOT"
python3 - "$SNAPSHOT" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
hosts=set(data.get("hosts", []))
if "persist.local" not in hosts:
  raise SystemExit("persist.local missing from config API")
if "__default__" not in hosts:
  raise SystemExit("__default__ missing from config API")
PY

curl -sS -X DELETE   -H "Host: ${HOST_HEADER}"   -H "Content-Type: application/json"   -H "X-Guardrails-Config-Host: persist.local"   --data '{"host":"persist.local"}'   "${API_BASE}/config/api" >/dev/null

curl_json "$HOST_HEADER" GET "/config/api" > "$SNAPSHOT"
python3 - "$SNAPSHOT" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
hosts=set(data.get("hosts", []))
if "persist.local" in hosts:
  raise SystemExit("persist.local was not removed")
if "__default__" not in hosts:
  raise SystemExit("__default__ missing after cleanup")
PY

echo "config_persistence ok"

