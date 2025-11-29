# Test Plan & Coverage Map

This file inventories the test suites we will add under `tests/` and the configuration each suite needs. The goal is exhaustive coverage of the Guardrails NGINX connector so future changes cannot introduce regressions.

## Test Environment & Prerequisites
- Run tests against the NGINX bundle in `/etc/nginx` with config entrypoint `nginx.conf`; validate with `nginx -t -c /etc/nginx/nginx.conf` before any reloads.
- Use local loopback ports to avoid hitting production:  
  - Upstream origin stub (acts as `$backend_origin_effective` target): `http://127.0.0.1:18080`.  
  - Guardrails API stub (replaces real Calypso backend): `http://127.0.0.1:18081`. It must support responses for `flagged`, `redacted`, and `cleared` outcomes plus streaming chunked responses.
- Place transient shared-dict state at `/var/cache/nginx/guardrails_config.json` (already configured). Tests that mutate state should reset this file between cases.
- TLS: use the repo’s self-signed certs in `certs/sideband-local.crt|key` for 443 scenarios or switch servers to plaintext for local runs.
- Logging: assertions read `/var/log/nginx/sideband*.log` for structured fields (e.g., `pattern_result`, `pattern_id`, `api_key_name`).
- QuickJS tooling: `njs -n QuickJS -p njs -m <module>` is available for unit-style checks of helper modules.
- All integration cases send requests with `Host: tests.local`; each case pushes its own `config.json` before executing requests.

## Fixtures to Prepare
- `tests/fixtures/requests/` sample bodies:
  - Chat-style JSON with `.messages[-1].content` containing safe text.
  - Payload with PII/secret markers to trigger redaction (`password=secret123`, `ssn: 123-45-6789`).
  - Streaming SSE transcript mirroring LLM deltas.
  - Streaming boundary and final-inspection variants (`stream_boundary_chat.json`, `stream_final_chat.json`).
  - Inspection override bodies (`inspect_off_chat.json`) and large payload stressor (`large_chat.json`).
- `tests/fixtures/config/`:
  - Default host config (`__default__`) matching SPEC defaults.
  - Host override example (`api.example.com`) with `inspectMode=request`, `backendOrigin=http://127.0.0.1:18080`, `requestExtractors=["pat_req"]`, `responseExtractors=["pat_resp"]`, `extractorParallelEnabled=true`.
- `tests/fixtures/api_keys.json`: multiple keys including one with custom `blockingResponse`.
- `tests/fixtures/patterns.json`: request, response, and response_stream contexts with matchers (equals/contains/exists) tied to the fixture keys.

## Planned Test Suites
- **Config Resolution (njs/utils.js::readScanConfig)**
  - Default merge behaviour and enum validation.
  - Host selection priority: explicit argument → `X-Guardrails-Config-Host` → `Host` → fallback `__default__`.
  - Override precedence of request headers (`X-Sideband-*`) versus stored config.
  - Parallel forwarding auto-disable when request redaction is on.

- **Config API (`/config/api`)**
  - GET returns defaults, options, and host list.
  - POST creates new host; duplicate host rejects with 409.
  - PATCH validation errors for bad enums/urls; successful merge updates snapshot.
  - DELETE protects `__default__` (400) and removes non-default hosts.
  - OPTIONS exposes correct Allow + CORS headers.

- **API Keys API (`/config/api/keys`)**
  - POST requires unique `name`, non-empty `key`; generates `ak_*` ids and timestamps.
  - `blockingResponse` sanitization and fallback when fields invalid.
  - PATCH enforces name uniqueness, partial updates bump `updated_at`.
  - DELETE removes by `id`; GET reflects sanitized responses.

- **Patterns API (`/config/api/patterns`)**
  - Context validation (`request|response|response_stream` + alias handling).
  - Paths/matchers required except for `response_stream`.
  - Matchers needing at least one of `equals|contains|exists`; rejection otherwise.
  - Name uniqueness per context; API key reference must exist.
  - CRUD lifecycle mirrored in GET results; OPTIONS headers present.

- **Collector API (`/collector/api`)**
  - GET exposes `total`/`remaining` and caps entries at 50.
  - POST `{count}` clamps >50; decrements on captures; `{action: "clear"}` resets.
  - Verify collected samples match request/response bodies from live pipeline tests.

- **Proxy & Inspection Pipeline (`njs/sideband.js`)**
  - Sequential vs parallel forward modes; warning/logs when redaction requested with parallel.
  - Guardrails outcomes:
    - `cleared` → pass-through untouched.
    - `flagged` → block with API-key-specific `blockingResponse` or default.
    - `redacted` with applicable matches → body masked; with no matches → block.
  - Pattern matcher gating (equals/contains/exists) controls whether Guardrails is called.
  - Request redaction applied only when enabled; streaming responses never mutated.
  - Bypass path `/api/tags` skips inspection and proxies directly.
  - Fail-open fallback: simulated JS exception still proxies upstream unless optional fail-closed block is toggled.

- **Streaming Inspection**
  - SSE detection on `text/event-stream` and `data:` lines.
  - Chunk inspection with configured `responseStreamChunkSize`/`responseStreamChunkOverlap`, including tokens split across chunk boundaries.
  - Heartbeat/comment lines (`: keep-alive`) are ignored while streaming.
  - Final inspection toggle validates pass-through when disabled and blocking when enabled.

- **Backend Origin Resolution (`utils.backendOriginVar`)**
  - Correct URI from per-host config; preserves scheme/host; rejects invalid values.
  - Host list maintenance: adding/removing hosts updates `config:hosts` and blocks deleting `__default__`.

- **Logging & Telemetry**
  - `pattern_result` log lines contain `pattern_id`, `api_key_name`, and outcome.
  - Log level respects `X-Sideband-Log` overrides (`debug|info|warn|err`) and appears in error logs.

- **Config Persistence & Cache Hygiene**
  - Guardrails config snapshot at `/var/cache/nginx/guardrails_config.json` records new hosts, retains `__default__`, and cleans up deletes.

- **Fixture Breadth & Header Overrides**
- Inspection can be turned off via `X-Sideband-Inspect: off` (BLOCK_ME should pass). 
- Request-only inspection via `X-Sideband-Inspect: request` leaves response flags untouched.
- Large payloads still proxy successfully without truncation.

## Execution Plan
- Unit-like njs scripts under `tests/njs/` to exercise helpers (`utils.js`, `redaction.js`, `sideband_client.js`) via `njs -n QuickJS`. (still TODO)
- HTTP integration scripts now live one-per-case under `tests/integration/cases/<case>/client.sh`; each script starts its own stub server, pushes the per-case `config.json` (host `tests.local`), seeds keys/patterns, runs assertions, and cleans up temp artifacts.
- `tests/integration/run_all.sh` iterates every case (or a provided subset) so suites can be run individually or in bulk.
- Future: end-to-end flows under `tests/e2e/` that spin up backend/Guardrails stubs, send representative chat requests (blocking, redaction, pass-through, streaming), and validate responses plus collector output and logs.

## Current Assets
- Stub servers: `tests/servers/stub_servers.py` launches both backend (port 18080) and Guardrails (port 18081) emulators used by integration tests.
  - Backend exposes `/api/stream-boundary`, `/api/stream-final`, and `/api/stream-noise` SSE routes to exercise chunk overlap, final inspection, and heartbeat handling.
- Per-case integration scripts: `tests/integration/cases/*/client.sh` each push their own `config.json` (host `tests.local`), start a local stub (`server.py`), seed API keys/patterns, and assert the specific behaviour.
  - Example: `tests/integration/cases/pass_through/client.sh` (200 passthrough), `.../stream_final` (toggle stream inspection), `.../config_persistence` (add/remove extra host), etc.
- Runner: `tests/integration/run_all.sh` executes all cases or a named subset:  
  - `tests/integration/run_all.sh` (everything)  
  - `tests/integration/run_all.sh stream_flag logging_pattern_result`

## Cleanup Requirements
- Each test must restore shared dict contents to the default snapshot (or delete the cache file) to avoid cross-test contamination.
- Temporary backend/Guardrails stub servers should bind to high ports and be shut down at test end.
- Log files may be tailed but should not be truncated unless explicitly part of a cleanup step.
