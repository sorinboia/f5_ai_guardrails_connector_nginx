# F5 AI Guardrails NGINX Connector

This configuration turns NGINX into an AI safety reverse proxy that inspects every request and response with F5 AI Guardrails before traffic reaches your model backend. It runs a QuickJS (njs) pipeline that can redact sensitive content, block high-risk interactions, and capture telemetry samples while keeping latency low.

## Architecture Overview
- **Port 11434 server** (`conf.d/guardrails_connector.conf`) accepts client traffic, serves the configuration UI, and proxies AI requests to your upstream (default `backend_upstream`).
- **Request pipeline** (`njs/sideband.js`) reads the JSON payload, extracts conversational context, sends it to F5 AI Guardrails via `ngx.fetch`, applies returned redactions, and decides whether to block or forward the call.
- **Configuration store** leverages NGINX key-value variables (`scan_config_*`, `sideband_*`, `collector_*`) so edits apply instantly without a reload.
- **Management APIs** expose runtime controls:
  - `/config/api` (`njs/config_api.js`) to inspect or patch inspection settings.
  - `/collector/api` (`njs/collector_api.js`) to schedule and read traffic samples.
- **HTML/React UI** (`html/scanner-config.html`) consumes the APIs for a point-and-click control surface at `/config/ui`.

## Directory Tour
- `conf.d/guardrails_connector.conf` – NGINX server + upstream wiring, JS engine setup, request header maps, and logging configuration.
- `njs/sideband.js` – Main handler orchestrating inspection, redaction, backend fetches, and telemetry capture.
- `njs/sideband_client.js` – Minimal HTTP client that posts extracted context to F5 AI Guardrails using `ngx.fetch`.
- `njs/redaction.js` – Translates guardrail regex matches into in-place JSON masking.
- `njs/utils.js` – Shared helpers for logging, JSON path extraction, config normalization, and key-value persistence.
- `njs/config_api.js` – Implements `/config/api` GET/PATCH/OPTIONS.
- `njs/collector_store.js` & `njs/collector_api.js` – Manage sample capture quotas and expose `/collector/api`.
- `html/scanner-config.html` – Single-page React UI served at `/config/ui`; adjust branding or copy here as needed.
- `scripts/`, `AGENTS.md`, and other top-level files – Utility material outside the core connector.

## Prerequisites
1. NGINX built with the njs (QuickJS) module (`ngx_http_js_module`) and subrequest support.
2. Outbound HTTPS reachability from the proxy to your F5 AI Guardrails endpoint.
3. A bearer token scoped for the Guardrails Scan API.
4. An upstream model service reachable at the address configured in the `backend_upstream` block.

## Initial Setup
1. **Clone or copy files** into `/etc/nginx/` (or equivalent). Ensure `js_path` in the server block points to the `njs/` directory.
2. **Configure upstream** by editing `conf.d/guardrails_connector.conf`:
   - Update the `upstream backend_upstream` server line to your model endpoint (keep `proxy_set_header Connection ""` for reuse).
3. **Provide Guardrails credentials** without hard-coding secrets:
   - Export them as environment variables before starting NGINX, then read them via `env` and `set` directives, or populate key-value stores:
     ```nginx
     env F5_GUARDRAILS_URL;
     env F5_GUARDRAILS_TOKEN;
     map "" $sideband_url    { default $env_F5_GUARDRAILS_URL; }
     map "" $sideband_bearer { default $env_F5_GUARDRAILS_TOKEN; }
     ```
   - You may also use the configuration API (see below) to override defaults at runtime.
4. **Populate default scan settings** by seeding `scan_config_*` variables (e.g., via `js_set`, `set`, or `kv`). The defaults are:
   - `inspectMode=both`, `redactMode=both`, `logLevel=info`, `requestForwardMode=sequential`.
5. **Validate & reload**:
   - `nginx -t -c /etc/nginx/nginx.conf`
   - `nginx -s reload`

## Request & Response Flow
1. Client hits `/api/chat` (or any location wired to the server).
2. `sideband.handle` reads the body, using `REQUEST_PATHS_DEFAULT` / `RESPONSE_PATHS_DEFAULT` to extract conversational context.
3. The handler posts the context to F5 AI Guardrails (`callSideband`) with the configured bearer token.
4. Based on Guardrails output:
   - `flagged` → returns HTTP 200 with a safe placeholder body (`"F5 AI Guardrails blocked this request"`).
   - `redacted` → applies regex match masks inside the JSON structure before continuing.
   - `cleared` → forwards unmodified content.
5. If request redaction is enabled, the sanitized payload is forwarded to `/backend/` via `r.subrequest`.
6. The backend response is optionally inspected/redacted.
7. `collector_store.recordSample` saves request/response pairs when the collection quota is positive.

## Runtime Controls
### Headers
- `X-Sideband-Inspect`: `off`, `request`, `response`, or `both`.
- `X-Sideband-Redact`: matches inspect values, toggling redaction per phase.
- `X-Sideband-Log`: `debug`, `info`, `warn`, `err` (raises log verbosity for a single request).
- `X-Sideband-Forward`: `sequential` (default) or `parallel` to overlap upstream fetch with Guardrails scanning when safe.

### Key-Value Variables
`njs/utils.readScanConfig` pulls the following from the NGINX key-value store:
- `scan_config_inspect_mode`
- `scan_config_redact_mode`
- `scan_config_log_level`
- `scan_config_request_forward_mode`

The configuration API writes these safely using `applyConfigPatch`, letting you persist changes without touching disk files.

## Management APIs
All responses are JSON with `cache-control: no-store`.

### `/config/api`
- `GET` → Current config plus server-enforced defaults/enums.
- `PATCH` → Body with any of: `inspectMode`, `redactMode`, `logLevel`, `requestForwardMode`, `requestExtractors`, `responseExtractors`, `extractorParallelEnabled`. Validation errors return `400`.
- `OPTIONS` → CORS hints for browser clients.
  - Note: legacy `requestPaths` and `responsePaths` fields were removed; the proxy now relies on built-in selector defaults.

### `/collector/api`
- `GET` → Returns `{ total, remaining, entries[] }`.
- `POST` with `{ "action": "clear" }` → Resets stored samples.
- `POST` with `{ "count": <int> }` → Schedules sample capture; limited to 50 stored entries.
- `OPTIONS` → CORS hints.

### Sample Workflow
```bash
# Fetch config
curl http://localhost:11434/config/api

# Enable response-only inspection
curl -X PATCH http://localhost:11434/config/api \
  -H "content-type: application/json" \
  -d '{"inspectMode":"response"}'

# Collect next 5 interactions
curl -X POST http://localhost:11434/collector/api \
  -H "content-type: application/json" \
  -d '{"count":5}'
```

## UI Usage
1. Navigate to `http://<host>:11434/config/ui`.
2. The React app loads current settings via `/config/api` and mirrors any updates you submit.
3. Use the sidebar to adjust inspection modes, redaction, extraction profiles, logging level, and request forwarding.
4. The UI surfaces toaster notifications for API successes/errors; inspect browser devtools for detailed payloads during troubleshooting.
5. To customize branding or helper copy, edit `html/scanner-config.html` and reload NGINX.

`/collector/ui` redirects to the same page, ensuring a single entry point for operators.

## Smoke Testing the Proxy
After every configuration tweak:
1. `nginx -t -c /etc/nginx/nginx.conf`
2. `nginx -s reload`
3. Issue a test prompt:
   ```bash
   curl http://localhost:11434/api/chat -H "content-type: application/json" -d '{
     "model": "llama3.1:8b",
     "messages": [
       { "role": "system", "content": "You are a helpful assistant." },
       { "role": "user", "content": "Write me a haiku about open-source AI." }
     ],
     "stream": false
   }'
   ```
4. Tail logs for insight:
   - `tail -f /var/log/nginx/sideband.error.log`
   - `tail -f /var/log/nginx/sideband.access.log`

Guardrails blocks return HTTP 200 with the message defined in `buildBlockedBody`. Redactions retain the original HTTP status but mask flagged fields.

## Development & Verification
- **Static analysis**: `njs -n QuickJS -p njs -m sideband.js` (or swap in `config_api.js`, etc.) to ensure syntax validity.
- **Quick unit harness**: craft an inline script under `njs/tests/` and run `njs -q njs/tests/<file>.js`.
- **Configuration safety**: keep `REQUEST_PATHS_DEFAULT` and `RESPONSE_PATHS_DEFAULT` aligned with your model schema; use `/config/api` patches for overrides.
- **Secrets**: never commit live Guardrails tokens—inject via environment variables or an external secret manager.
- **Parallel forwarding**: only enable (`requestForwardMode=parallel`) when request redaction is disabled; otherwise the handler falls back to sequential mode.
- **Integration tests**: each scenario lives under `tests/integration/cases/<case>/client.sh`, which seeds `tests.local` config, starts stub servers, and runs assertions. Execute a single case directly or run many via `tests/integration/run_all.sh` (accepts optional case names).

## Operational Tips
- Rotate Guardrails credentials by updating the env variables and reloading (`nginx -s reload`); the runtime store will pick them up without downtime.
- When expanding upstreams, add servers inside the existing `backend_upstream` block so they inherit Guardrails protection.
- Keep an eye on `collector_collect_remaining` (see `/collector/api`) to avoid stale sample quotas; clear when the investigation completes.
- To disable inspection temporarily, PATCH `{"inspectMode":"off","redactMode":"off"}` and monitor for increased risk before re-enabling.

With these pieces in place, the connector delivers end-to-end inspection, redaction, and telemetry powered by F5 AI Guardrails while exposing a simple UI for operators.
