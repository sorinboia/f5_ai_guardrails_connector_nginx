#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://127.0.0.1:11434"
HOST_HEADER="tests.local"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDS_JSON="$ROOT/.pattern_ids.json"
STUB_LOG="$ROOT/.stub.log"

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
  local outfile="$ROOT/.tmp_response.json"
  local status
  status=$(curl -s -o "$outfile" -w "%{http_code}" -H "Host: ${HOST_HEADER}" -H "Content-Type: application/json" --data @"$body_file" "${BASE_URL}${path}")
  echo "$status" "$outfile"
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
  test_collector

  echo "All tests passed."
}

main "$@"
