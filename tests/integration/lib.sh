#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MGMT_BASE="http://127.0.0.1:22100"
PROXY_BASE="http://127.0.0.1:22080"
DEFAULT_KEYS_FIXTURE="$ROOT/fixtures/config/api_keys.json"
DEFAULT_PATTERNS_FIXTURE="$ROOT/fixtures/config/patterns.json"

curl_json() {
  local host_header="$1"; shift
  local method="$1"; shift
  local path="$1"; shift
  curl -sS -X "$method" \
    -H "Host: ${host_header}" \
    -H "Content-Type: application/json" \
    "$@" \
    "${MGMT_BASE}${path}"
}

start_stubs() {
  local server_script="$1"
  local log_file="$2"
  echo "Starting stub server ${server_script}..."
  python3 "$server_script" >"$log_file" 2>&1 &
  STUB_PID=$!
  sleep 0.5
}

stop_stubs() {
  if [[ -n "${STUB_PID:-}" ]] && kill -0 "$STUB_PID" 2>/dev/null; then
    kill "$STUB_PID" || true
    wait "$STUB_PID" || true
  fi
}

cleanup_entities() {
  local host_header="$1"
  echo "Cleaning API keys/patterns for host ${host_header}..."
  local ids
  ids=$(curl_json "$host_header" GET "/config/api/keys" | python3 -c 'import sys,json; data=json.load(sys.stdin); print("\n".join([item["id"] for item in data.get("items",[]) if item.get("name","" ).startswith("test-")]))')
  for id in $ids; do
    curl_json "$host_header" DELETE "/config/api/keys" --data "{\"id\":\"$id\"}" >/dev/null
  done

  ids=$(curl_json "$host_header" GET "/config/api/patterns" | python3 -c 'import sys,json; data=json.load(sys.stdin); print("\n".join([item["id"] for item in data.get("items",[]) if item.get("name","" ).startswith("pat-")]))')
  for id in $ids; do
    curl_json "$host_header" DELETE "/config/api/patterns" --data "{\"id\":\"$id\"}" >/dev/null
  done
}

create_api_keys() {
  local host_header="$1"
  ROOT="$ROOT" HOST_HEADER="$host_header" MGMT_BASE="$MGMT_BASE" python3 - <<'PY'
import json, subprocess, pathlib, os
root = pathlib.Path(os.environ["ROOT"])
keys = json.loads((root / "fixtures/config/api_keys.json").read_text())
url = os.environ["MGMT_BASE"] + "/config/api/keys"
headers = ["-H", f"Host: {os.environ['HOST_HEADER']}", "-H", "Content-Type: application/json"]
for rec in keys:
    subprocess.check_call(["curl","-sS","-X","POST",*headers,"--data",json.dumps(rec),url], stdout=subprocess.DEVNULL)
PY
}

create_patterns() {
  local host_header="$1"
  ROOT="$ROOT" HOST_HEADER="$host_header" MGMT_BASE="$MGMT_BASE" python3 - <<'PY'
import json, subprocess, pathlib, os
root = pathlib.Path(os.environ["ROOT"])
patterns = json.loads((root / "fixtures/config/patterns.json").read_text())
url = os.environ["MGMT_BASE"] + "/config/api/patterns"
headers = ["-H", f"Host: {os.environ['HOST_HEADER']}", "-H", "Content-Type: application/json"]
for rec in patterns:
    subprocess.check_call(["curl","-sS","-X","POST",*headers,"--data",json.dumps(rec),url], stdout=subprocess.DEVNULL)
PY
}

configure_host_from_file() {
  local host_header="$1"
  local config_file="$2"
  HOST_HEADER="$host_header" ROOT="$ROOT" CONFIG_FILE="$config_file" MGMT_BASE="$MGMT_BASE" python3 - <<'PY'
import json, subprocess, pathlib, os, sys
root = pathlib.Path(os.environ["ROOT"])
cfg = json.loads(pathlib.Path(os.environ["CONFIG_FILE"]).read_text())
patterns = json.loads(subprocess.check_output([
    "curl","-sS","-X","GET",
    "-H", f"Host: {os.environ['HOST_HEADER']}",
    "-H", "Content-Type: application/json",
    os.environ["MGMT_BASE"] + "/config/api/patterns"
]))
id_map = {item["name"]: item["id"] for item in patterns.get("items", [])}
req_names = cfg.pop("requestExtractors", [])
resp_names = cfg.pop("responseExtractors", [])
missing = [n for n in req_names + resp_names if n not in id_map]
if missing:
    raise SystemExit(f"Missing pattern ids for: {missing}")
cfg_data = cfg.get("config", {})
cfg_data["requestExtractors"] = [id_map[n] for n in req_names]
cfg_data["responseExtractors"] = [id_map[n] for n in resp_names]
payload = {"host": cfg.get("host"), **cfg_data}
subprocess.check_call([
    "curl","-sS","-X","PATCH",
    "-H", f"Host: {os.environ['HOST_HEADER']}",
    "-H", "Content-Type: application/json",
    "--data", json.dumps(payload),
    os.environ["MGMT_BASE"] + "/config/api"
], stdout=subprocess.DEVNULL)
PY
}

run_curl() {
  local host_header="$1"; shift
  local body_file="$1"; shift
  local path="$1"; shift
  local outfile="$1"; shift
  local -a extra=("$@")
  local status
  status=$(curl -s -o "$outfile" -w "%{http_code}" -H "Host: ${host_header}" -H "Content-Type: application/json" "${extra[@]}" --data @"$body_file" "${PROXY_BASE}${path}")
  echo "$status"
}

latest_error_log() {
  for candidate in /var/log/nginx/sideband.error.log /var/log/nginx/sideband-https.error.log; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  touch /var/log/nginx/sideband.error.log
  echo /var/log/nginx/sideband.error.log
}

log_capture_start() {
  LOG_FILE=$(latest_error_log)
  LOG_CURSOR=$(wc -c <"$LOG_FILE")
}

log_capture_dump() {
  local outfile="$1"
  local start=$((LOG_CURSOR + 1))
  tail -c +$start "$LOG_FILE" >"$outfile"
}

set_stream_flags() {
  local host_header="$1"; shift
  local enabled="$1"; shift
  local final_enabled="$1"; shift
  local overlap="$1"; shift
  local payload
  payload=$(HOST_HEADER="$host_header" ENABLED="$enabled" FINAL_ENABLED="$final_enabled" OVERLAP="$overlap" python3 - <<'PY'
import json, os
payload = {
  "host": os.environ["HOST_HEADER"],
  "responseStreamEnabled": os.environ["ENABLED"].lower() == "true",
  "responseStreamFinalEnabled": os.environ["FINAL_ENABLED"].lower() == "true",
  "responseStreamChunkOverlap": int(os.environ["OVERLAP"]),
}
print(json.dumps(payload))
PY
)
  curl_json "$host_header" PATCH "/config/api" --data "$payload" >/dev/null
}

reload_nginx() {
  nginx -t -c /etc/nginx/nginx.conf
  nginx -s reload
}
