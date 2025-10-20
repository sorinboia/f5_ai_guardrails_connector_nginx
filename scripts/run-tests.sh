#!/usr/bin/env bash

set -euo pipefail

log_info() {
  printf '==> %s\n' "$*"
}

log_ok() {
  printf '[OK] %s\n' "$*"
}

log_err() {
  printf '[ERR] %s\n' "$*" >&2
}

show_help() {
  cat <<'EOF'
Usage: scripts/run-tests.sh [options]

Runs baseline validation for the Guardrails NGINX proxy:
  * nginx -t -c /etc/nginx/nginx.conf
  * optional nginx -s reload (with --reload)
  * QuickJS module smoke load of sideband.js and utils.js
  * optional curl smoke test against configurable chat endpoint

Options:
  --skip-smoke         Skip curl smoke test (useful when upstream not available)
  --reload             Issue nginx -s reload after config test passes
  --smoke-url <url>    Override smoke test URL (default: http://127.0.0.1/chat)
  --payload <path>     Override JSON payload used for smoke test
  -h, --help           Show this help text
EOF
}

skip_smoke=0
do_reload=0
smoke_url="http://localhost:11434/api/chat"
chat_payload="scripts/fixtures/chat_request.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-smoke)
      skip_smoke=1
      shift
      ;;
    --reload)
      do_reload=1
      shift
      ;;
    --smoke-url)
      smoke_url="${2:-}"
      if [[ -z "$smoke_url" ]]; then
        echo "--smoke-url requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --payload)
      chat_payload="${2:-}"
      if [[ -z "$chat_payload" ]]; then
        echo "--payload requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

log_info "Checking nginx configuration syntax"
nginx_output="$(nginx -t -c /etc/nginx/nginx.conf 2>&1)" || {
  log_err "nginx -t failed:"
  printf '%s\n' "$nginx_output" >&2
  exit 1
}
printf '%s\n' "$nginx_output"
log_ok "nginx syntax check succeeded"

if [[ $do_reload -eq 1 ]]; then
  log_info "Reloading nginx"
  if ! nginx -s reload; then
    log_err "nginx reload failed"
    exit 1
  fi
  log_ok "nginx reload signaled"
fi

log_info "Validating QuickJS modules"
if njs -n QuickJS -p njs -m njs/sideband.js >/dev/null 2>&1; then
  log_ok "sideband.js loaded successfully under QuickJS"
else
  log_err "sideband.js failed QuickJS validation"
  njs -n QuickJS -p njs -m njs/sideband.js
  exit 1
fi

if njs -n QuickJS -p njs -m njs/utils.js >/dev/null 2>&1; then
  log_ok "utils.js loaded successfully under QuickJS"
else
  log_err "utils.js failed QuickJS validation"
  njs -n QuickJS -p njs -m njs/utils.js
  exit 1
fi

if [[ $skip_smoke -eq 0 ]]; then
  if [[ ! -f "$chat_payload" ]]; then
    log_err "Smoke test payload missing: $chat_payload"
    exit 1
  fi

  log_info "Performing chat endpoint smoke test (${smoke_url})"
  response_tmp="$(mktemp /tmp/guardrails-smoke.XXXXXX)"
  header_tmp="$(mktemp /tmp/guardrails-smoke-headers.XXXXXX)"
  trap 'rm -f "$response_tmp" "$header_tmp"' EXIT

  curl -sS -D "$header_tmp" \
    -H "Content-Type: application/json" \
    --data "@${chat_payload}" \
    "$smoke_url" > "$response_tmp"

  status_line="$(head -n1 "$header_tmp")"
  if [[ -z "$status_line" ]]; then
    log_err "Smoke test failed: no response received from ${smoke_url}"
    exit 1
  fi
  if ! grep -E -q 'HTTP/[0-9.]+ 200' <<<"$status_line"; then
    log_err "Smoke test failed: unexpected status line: $status_line"
    echo "Response body:"
    cat "$response_tmp"
    exit 1
  fi
  log_ok "Smoke test succeeded with status ${status_line}"
  echo "Headers stored at $header_tmp; body stored at $response_tmp"
else
  log_info "Skipping smoke test (per --skip-smoke)"
fi

log_ok "All checks passed."
