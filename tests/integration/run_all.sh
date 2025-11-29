#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://127.0.0.1:11434"
HOST_HEADER="tests.local"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDS_JSON="$ROOT/.pattern_ids.json"
STUB_LOG="$ROOT/.stub.log"
LOG_CAPTURE="$ROOT/.log_capture.txt"

curl_json() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sS -X "$method" \
    -H "Host: ${HOST_HEADER}" \
    -H "Content-Type: application/json" \
    "$@" \
    "${BASE_URL}${path}"
}

start_stubs() {
  echo "Starting stub servers..."
  python3 "$ROOT/servers/stub_servers.py" > "$STUB_LOG" 2>&1 &
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
  echo "Cleaning prior test API keys/patterns..."
  local ids
  ids=$(curl_json GET "/config/api/keys" | python3 -c 'import sys,json; data=json.load(sys.stdin); print("\n".join([item["id"] for item in data.get("items",[]) if item.get("name","").startswith("test-")]))')
  for id in $ids; do
    curl_json DELETE "/config/api/keys" --data "{\"id\":\"$id\"}" >/dev/null
  done

  ids=$(curl_json GET "/config/api/patterns" | python3 -c 'import sys,json; data=json.load(sys.stdin); print("\n".join([item["id"] for item in data.get("items",[]) if item.get("name","").startswith("pat-")]))')
  for id in $ids; do
    curl_json DELETE "/config/api/patterns" --data "{\"id\":\"$id\"}" >/dev/null
  done
}

create_api_keys() {
  echo "Creating API keys..."
  ROOT="$ROOT" python3 - <<'PY'
import json, subprocess, pathlib, os
root = pathlib.Path(os.environ["ROOT"])
keys = json.loads((root / "fixtures/config/api_keys.json").read_text())
url = "http://127.0.0.1:11434/config/api/keys"
headers = ["-H", "Host: tests.local", "-H", "Content-Type: application/json"]
for rec in keys:
    subprocess.check_call(["curl","-sS","-X","POST",*headers,"--data",json.dumps(rec),url], stdout=subprocess.DEVNULL)
PY
}

create_patterns() {
  echo "Creating patterns..."
  ROOT="$ROOT" python3 - <<'PY'
import json, subprocess, pathlib, os
root = pathlib.Path(os.environ["ROOT"])
patterns = json.loads((root / "fixtures/config/patterns.json").read_text())
url = "http://127.0.0.1:11434/config/api/patterns"
headers = ["-H", "Host: tests.local", "-H", "Content-Type: application/json"]
for rec in patterns:
    subprocess.check_call(["curl","-sS","-X","POST",*headers,"--data",json.dumps(rec),url], stdout=subprocess.DEVNULL)
PY
}

capture_pattern_ids() {
  echo "Capturing pattern ids..."
  curl_json GET "/config/api/patterns" > "$IDS_JSON"
  python3 - "$IDS_JSON" <<'PY'
import json, sys, pathlib
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
names = {item["name"]: item["id"] for item in data.get("items", [])}
wanted = ["pat-req-block","pat-req-redact","pat-req-redact-fail","pat-resp-flag","pat-stream-flag"]
out = {k: names[k] for k in wanted if k in names}
path.write_text(json.dumps(out, indent=2))
missing = [k for k in wanted if k not in out]
if missing:
    raise SystemExit(f"Missing patterns: {missing}")
PY
}

configure_host() {
  echo "Configuring host tests.local..."
  ROOT="$ROOT" python3 - "$IDS_JSON" <<'PY'
import json, sys, pathlib, subprocess, os
ids = json.loads(pathlib.Path(sys.argv[1]).read_text())
root = pathlib.Path(os.environ["ROOT"])
cfg = json.loads((root / "fixtures/config/default_host.json").read_text())["config"]
cfg["requestExtractors"] = [ids["pat-req-block"], ids["pat-req-redact"], ids["pat-req-redact-fail"]]
cfg["responseExtractors"] = [ids["pat-resp-flag"], ids["pat-stream-flag"]]
cfg["extractorParallelEnabled"] = False
payload = json.dumps({"host": "tests.local", **cfg})
cmd = [
  "curl","-sS","-X","PATCH",
  "-H","Host: tests.local",
  "-H","Content-Type: application/json",
  "--data", payload,
  "http://127.0.0.1:11434/config/api"
]
subprocess.check_call(cmd, stdout=subprocess.DEVNULL)
PY
}

assert_json() {
  local file="$1"; shift
  python3 - "$file" "$@" <<'PY'
import json,sys
payload=json.load(open(sys.argv[1]))
exprs=sys.argv[2:]
for expr in exprs:
    key, expect = expr.split("=",1)
    cur = payload
    for part in key.split("."):
        if isinstance(cur, list):
            part=int(part)
        cur = cur[part]
    if str(cur) != expect:
        raise SystemExit(f"Assertion failed: {key}={cur} (expected {expect})")
PY
}

run_curl() {
  local body_file="$1"; shift
  local path="$1"; shift
  local -a extra=("$@")
  local outfile="$ROOT/.tmp_response.json"
  local status
  status=$(curl -s -o "$outfile" -w "%{http_code}" -H "Host: ${HOST_HEADER}" -H "Content-Type: application/json" "${extra[@]}" --data @"$body_file" "${BASE_URL}${path}")
  echo "$status" "$outfile"
}

latest_error_log() {
  for candidate in /var/log/nginx/sideband.error.log /var/log/nginx/sideband-https.error.log; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  # Create default log file if none yet exist
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

test_pass_through() {
  echo "Test: pass-through (cleared)"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/safe_chat.json" "/api/chat")"
  [[ "$status" == "200" ]] || { echo "Expected 200, got $status"; exit 1; }
  python3 - "$outfile" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
content=data.get("message",{}).get("content","")
assert "Hello from tests.local" in content
assert "*" not in content
PY
}

test_block_request() {
  echo "Test: request flagged -> block"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/block_chat.json" "/api/chat")"
  [[ "$status" == "451" ]] || { echo "Expected 451, got $status"; exit 1; }
  grep -q "blocked by tests" "$outfile" || { echo "Missing block message"; exit 1; }
}

test_redaction_success() {
  echo "Test: request redaction succeeds"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/redact_chat.json" "/api/chat")"
  [[ "$status" == "200" ]] || { echo "Expected 200, got $status"; exit 1; }
  python3 - "$outfile" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
content=data.get("message",{}).get("content","")
assert "REDACT_ME" not in content
assert "*" in content
PY
}

test_redaction_fail() {
  echo "Test: redaction failure blocks"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/redact_fail_chat.json" "/api/chat")"
  [[ "$status" == "200" ]] || { echo "Expected blocking status 200, got $status"; exit 1; }
  grep -q "Guardrails blocked this request" "$outfile" || { echo "Missing default block body"; exit 1; }
}

test_response_flag() {
  echo "Test: response inspection blocks flagged content"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/response_flag_chat.json" "/api/response-flag")"
  [[ "$status" == "451" ]] || { echo "Expected 451, got $status"; exit 1; }
}

test_stream_flag() {
  echo "Test: streaming inspection blocks chunk"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/stream_chat.json" "/api/stream")"
  [[ "$status" == "451" ]] || { echo "Expected 451, got $status"; exit 1; }
}

test_stream_chunk_boundary() {
  echo "Test: streaming chunk overlap catches boundary flag"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/stream_boundary_chat.json" "/api/stream-boundary")"
  [[ "$status" == "451" ]] || { echo "Expected 451 on boundary stream, got $status"; exit 1; }
}

set_stream_flags() {
  local enabled="$1"      # responseStreamEnabled toggle
  local final_enabled="$2" # responseStreamFinalEnabled toggle
  local overlap="$3"
  local payload
  payload=$(python3 - <<PY
import json
print(json.dumps({
  "host": "tests.local",
  "responseStreamEnabled": bool("${enabled}".lower() == "true"),
  "responseStreamFinalEnabled": bool("${final_enabled}".lower() == "true"),
  "responseStreamChunkOverlap": ${overlap:-8}
}))
PY
)
  curl_json PATCH "/config/api" --data "$payload" >/dev/null
}

test_stream_final_inspection() {
  echo "Test: final stream inspection only triggers when enabled"
  # Disable streaming inspection entirely, then re-enable with final check
  set_stream_flags false false 0
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/stream_final_chat.json" "/api/stream-final")"
  [[ "$status" == "200" ]] || { echo "Expected 200 with stream inspection off, got $status"; exit 1; }

  # Re-enable final pass to catch boundary token across chunks
  set_stream_flags true true 8
  read -r status2 outfile2 <<<"$(run_curl "$ROOT/fixtures/requests/stream_final_chat.json" "/api/stream-final")"
  [[ "$status2" == "451" ]] || { echo "Expected 451 with final inspection on, got $status2"; exit 1; }
}

test_stream_noise_heartbeat() {
  echo "Test: streaming parser ignores heartbeat/comment lines"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/stream_chat.json" "/api/stream-noise")"
  [[ "$status" == "451" ]] || { echo "Expected 451 on noisy stream, got $status"; exit 1; }
}

test_logging_pattern_result() {
  echo "Test: pattern_result log fields present"
  log_capture_start
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/block_chat.json" "/api/chat")"
  [[ "$status" == "451" ]] || { echo "Expected 451, got $status"; exit 1; }
  log_capture_dump "$LOG_CAPTURE"
  grep -q "pattern_result" "$LOG_CAPTURE" || { echo "Missing pattern_result log"; exit 1; }
  grep -q "pattern_id" "$LOG_CAPTURE" || { echo "Missing pattern_id in log"; exit 1; }
  grep -q "api_key_name" "$LOG_CAPTURE" || { echo "Missing api_key_name in log"; exit 1; }
  grep -qi "outcome" "$LOG_CAPTURE" || { echo "Missing outcome field in log"; exit 1; }
}

test_logging_level_override() {
  echo "Test: log level override via X-Sideband-Log"
  log_capture_start
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/block_chat.json" "/api/chat" -H "X-Sideband-Log: warn")"
  [[ "$status" == "451" ]] || { echo "Expected 451 with warn log override, got $status"; exit 1; }
  log_capture_dump "$LOG_CAPTURE"
  grep -q '"X-Sideband-Log":"warn"' "$LOG_CAPTURE" || { echo "Expected X-Sideband-Log header captured"; exit 1; }
}

test_config_persistence() {
  echo "Test: config snapshot persists hosts and cleans up"
  local cache_file=/var/cache/nginx/guardrails_config.json
  local backup="$ROOT/.config_backup.json"
  if [[ -f "$cache_file" ]]; then
    cp "$cache_file" "$backup"
  else
    echo '{}' >"$backup"
    touch "$cache_file"
  fi

  local payload
  payload=$(ROOT="$ROOT" python3 - <<'PY'
import json, pathlib, os
root = pathlib.Path(os.environ["ROOT"]) / "fixtures/config/default_host.json"
cfg = json.loads(root.read_text())
cfg["host"] = "persist.local"
print(json.dumps(cfg))
PY
)
  curl -sS -X POST \
    -H "Host: ${HOST_HEADER}" \
    -H "Content-Type: application/json" \
    -H "X-Guardrails-Config-Host: persist.local" \
    --data "$payload" \
    "${BASE_URL}/config/api" >/dev/null
  curl_json GET "/config/api" > "$ROOT/.config_snapshot.json"
  python3 - "$ROOT/.config_snapshot.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
hosts = set(data.get("hosts", []))
if "persist.local" not in hosts:
  raise SystemExit("persist.local missing from config API")
if "__default__" not in hosts:
  raise SystemExit("__default__ missing from config API")
PY

  curl -sS -X DELETE \
    -H "Host: ${HOST_HEADER}" \
    -H "Content-Type: application/json" \
    -H "X-Guardrails-Config-Host: persist.local" \
    --data '{"host":"persist.local"}' \
    "${BASE_URL}/config/api" >/dev/null
  curl_json GET "/config/api" > "$ROOT/.config_snapshot.json"
  python3 - "$ROOT/.config_snapshot.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
hosts = set(data.get("hosts", []))
if "persist.local" in hosts:
  raise SystemExit("persist.local was not removed")
if "__default__" not in hosts:
  raise SystemExit("__default__ missing after cleanup")
PY

  # leave cache as current state; backup kept for manual comparison if needed
}

test_inspect_off_pass_through() {
  echo "Test: inspection disabled via header skips blocking"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/inspect_off_chat.json" "/api/chat" -H "X-Sideband-Inspect: off")"
  [[ "$status" == "200" ]] || { echo "Expected 200 with inspect off, got $status"; exit 1; }
  python3 - "$outfile" <<'PY'
import json, sys
data=json.load(open(sys.argv[1]))
content=data.get("message",{}).get("content","")
assert "BLOCK_ME" in content
assert "*" not in content
PY
}

test_request_only_response_skip() {
  echo "Test: request-only inspection leaves response uninspected"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/response_flag_chat.json" "/api/response-flag" -H "X-Sideband-Inspect: request")"
  [[ "$status" == "200" ]] || { echo "Expected 200 with response inspection off, got $status"; exit 1; }
  grep -q "RESP_FLAG" "$outfile" || { echo "Expected RESP_FLAG to pass through"; exit 1; }
}

test_large_payload_pass_through() {
  echo "Test: large payload still proxied"
  read -r status outfile <<<"$(run_curl "$ROOT/fixtures/requests/large_chat.json" "/api/chat")"
  [[ "$status" == "200" ]] || { echo "Expected 200 for large payload, got $status"; exit 1; }
  size=$(stat -c%s "$outfile")
  [[ "$size" -gt 1000 ]] || { echo "Unexpectedly small response body"; exit 1; }
}

test_collector() {
  echo "Test: collector capture"
  curl_json POST "/collector/api" --data '{"action":"clear"}' >/dev/null
  curl_json POST "/collector/api" --data '{"count":2}' >/dev/null
  run_curl "$ROOT/fixtures/requests/safe_chat.json" "/api/chat" >/dev/null
  run_curl "$ROOT/fixtures/requests/redact_chat.json" "/api/chat" >/dev/null
  curl_json GET "/collector/api" > "$ROOT/.collector.json"
  python3 - "$ROOT/.collector.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
assert data.get("remaining") == 0
entries = data.get("entries", [])
assert len(entries) == 2
PY
}

main() {
  start_stubs
  trap stop_stubs EXIT

  echo "Validating nginx config..."
  nginx -t -c /etc/nginx/nginx.conf
  echo "Reloading nginx..."
  nginx -s reload

  cleanup_entities
  create_api_keys
  create_patterns
  capture_pattern_ids
  configure_host

  test_pass_through
  test_block_request
  test_redaction_success
  test_redaction_fail
  test_response_flag
  test_stream_flag
  test_stream_chunk_boundary
  test_stream_noise_heartbeat
  test_stream_final_inspection
  test_collector
  test_logging_pattern_result
  test_logging_level_override
  test_config_persistence
  test_inspect_off_pass_through
  test_request_only_response_skip
  test_large_payload_pass_through

  echo "All tests passed."
}

main "$@"
