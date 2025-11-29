#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CASES_DIR="$ROOT/integration/cases"

usage() {
  echo "Usage: $0 [case ...]"
  echo "Available cases:"
  (cd "$CASES_DIR" && ls -1)
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

cases=()
if [[ $# -gt 0 ]]; then
  cases=("$@")
else
  mapfile -t cases < <(cd "$CASES_DIR" && ls -1)
fi

for case in "${cases[@]}"; do
  script="$CASES_DIR/$case/client.sh"
  if [[ ! -x "$script" ]]; then
    echo "Missing client script for case: $case" >&2
    exit 1
  fi
  echo "==> Running $case"
  "$script"
  echo "==> $case complete"
done

echo "All selected cases passed."
