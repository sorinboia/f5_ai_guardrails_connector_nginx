# F5 AI Guardrails Node Connector — Technical Specification

This document is the canonical contract for the Node.js Fastify service that now replaces the legacy NGINX+njs stack. It defines every endpoint, header, shared store, pipeline behaviour, defaults, and invariants required to recreate the deployment.

---
## 1) Runtime Topology
- **Entrypoint**: `node/src/server.js` starts Fastify on HTTP port `11434` and (when cert/key exist) HTTPS port `11443`. TLS assets default to `/etc/nginx/certs/sideband-local.crt|key` so existing cert mounts keep working.
- **Static assets**: Served from `/etc/nginx/html` by `node/src/routes/static.js` (`scanner-config.html` + `/config/css|js/*`).
- **Config & state**: Persisted JSON file at `var/guardrails_config.json` (path overrideable via `CONFIG_STORE_PATH`). `server.js` watches the file for hot reload and mutates the in-memory store in place so route decorators stay valid.
- **MITM sidecar**: Container runs `mitmdump` with addon `mitmproxy.py`; listens on `0.0.0.0:10000`. CA files are written to `/var/lib/mitmproxy/` (HTTP) or `/root/.mitmproxy/` (when TLS terminates upstream) and downloaded via `/config/mitm/mitmproxy-ca-cert.(pem|cer)`.
- **Logging**: Pino logger in `node/src/logging/logger.js`; log level from env `LOG_LEVEL` (default `info`) or per-request overrides. Logs emit lower_snake_case fields consistent with previous telemetry.

---
## 2) External Interface (Ports & Routes)
- **Proxy catch‑all**: `/*` handled by `node/src/pipeline/proxyPipeline.js` via `node/src/routes/proxy.js`.
- **Bypass path**: `/api/tags` proxied directly to resolved backend origin without inspection.
- **Static/UI**: `/config/ui`, `/config/ui/keys`, `/config/ui/patterns` → `scanner-config.html`; `/config/ui/*` redirects strip trailing slash; `/collector/ui` redirects to `/config/ui`. `/config/css/*` and `/config/js/*` serve assets with `cache-control: no-store`.
- **Management APIs**: `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api` implemented in `node/src/routes/management.js` with helpers in `node/src/config/validate.js` and `node/src/config/store.js`.
- **MITM CA downloads**: `/config/mitm/mitmproxy-ca-cert.pem` (`application/x-pem-file`) and `.cer` (`application/pkix-cert`), `cache-control: no-store`, 404 if file missing.
- **Ports**: HTTP `11434`; HTTPS `11443` (optional); MITM `10000`.

---
## 3) Environment & Defaults (`node/src/config/env.js`)
- `BACKEND_ORIGIN` default `https://api.openai.com`.
- `SIDEBAND_URL` default `https://www.us1.calypsoai.app/backend/v1/scans`.
- `SIDEBAND_BEARER` default empty; `SIDEBAND_UA` default `njs-sideband/1.0`; `SIDEBAND_TIMEOUT_MS` default `5000`.
- `CA_BUNDLE` default `/etc/ssl/certs/ca-certificates.crt`.
- `HTTP_PORT` default `11434`; `HTTPS_PORT` default `443`; `HTTPS_CERT`/`HTTPS_KEY` default `/etc/nginx/certs/sideband-local.crt|key`; HTTPS enabled only if both files exist/read.
- `CONFIG_STORE_PATH` default `var/guardrails_config.json`.
- `serviceName` fixed `f5-ai-connector-node` for logs; tests use stub sideband URL override when host `tests.local` is detected.

---
## 4) Persistent Data Model (`node/src/config/store.js`)
JSON file schema:
```json
{
  "version": 1,
  "hosts": ["__default__", ...],
  "hostConfigs": { "<host>": { ...config fields... } },
  "apiKeys": [ { id, name, key, blockingResponse, created_at, updated_at } ],
  "patterns": [ { id, name, context, apiKeyName, paths, matchers, notes, created_at, updated_at } ],
  "collector": { entries: [], total: 0, remaining: 0 }
}
```
- `__default__` host must always exist and cannot be deleted.
- Writes are atomic: temp file + rename; watchers reload into live store.

---
## 5) Configuration Resolution (`node/src/config/validate.js`)
- **Host selection order**: explicit `host` arg → `X-Guardrails-Config-Host` header → HTTP `Host` header → `__default__`.
- **Defaults**:
  - `inspectMode=both`, `redactMode=both`, `logLevel=info`, `requestForwardMode=sequential`, `backendOrigin=env BACKEND_ORIGIN`.
  - `requestExtractors=[]`, `responseExtractors=[]`, `extractorParallel=false`.
  - Streaming: `responseStreamEnabled=true`, `responseStreamChunkSize=2048`, `responseStreamChunkOverlap=128`, `responseStreamFinalEnabled=true`, `responseStreamCollectFullEnabled=false`.
- **Enums/validation**: `inspect|redactMode ∈ off|request|response|both`; `logLevel ∈ debug|info|warn|err`; `requestForwardMode ∈ sequential|parallel`; `backendOrigin` must be http(s). Pattern/context enums match §7.
- **Header overrides**: `X-Sideband-Inspect`, `X-Sideband-Redact`, `X-Sideband-Log`, `X-Sideband-Forward`; invalid values are ignored (fall back to config).
- **Parallel safety**: parallel forward is disabled when request redaction is on; redaction never applied to streaming responses.

---
## 6) Guardrails Client (`node/src/pipeline/sidebandClient.js`)
- Uses `undici.fetch` with timeout `sid‌​ebandTimeoutMs`, CA bundle path, and UA `sidebandUa` (default `njs-sideband/1.0`).
- `tests.local` host forces sideband URL to `http://127.0.0.1:18081/backend/v1/scans` for local stubs.
- Request payload: `{ input, configOverrides:{}, forceEnabled:[], disabled:[], verbose:false }` with Bearer from selected API key or global bearer.
- Outcomes expected: `flagged`, `redacted`, `cleared` (see §7 for handling). Network/HTTP errors follow fail‑open then upstream fallback; double failure → 502.

---
## 7) Inspection & Forwarding Pipeline (`node/src/pipeline/proxyPipeline.js` & helpers)
1. **Resolve config & headers** (see §5) and upstream host for Host rewrite.
2. **Load API keys/patterns** from store; match requested extractors by ID and context.
3. **Request handling**:
   - Read body (buffer); log preview; skip inspection if `inspectMode` disables request phase.
   - If `requestForwardMode=parallel` and request redaction is enabled, force sequential.
   - Run request-phase patterns via `inspection.runInspectionStage` → Guardrails call per pattern when matchers allow.
   - Outcomes:
     - `flagged` → block with blockingResponse (API-key specific if present, else default 200 JSON `{message:"F5 AI Guardrails blocked this request"}`).
     - `redacted` → apply regex matches via `redaction.collectRedactionPlan/applyRedactions`; if no matches apply, block.
     - `cleared`/empty → continue.
4. **Upstream fetch**: forwarded with original method, headers (Host rewritten), body; keepalive enabled; buffering avoided. Backend origin resolved per host config; invalid URL falls back to env default.
5. **Response handling**:
   - Streaming detection via `pipeline/streaming.js` (SSE `data:` frames or `text/event-stream`). Assembles text from deltas and slices into overlapping chunks (default 2048/128) for `response_stream` inspection. Streaming redaction is disabled; blocks allowed; final inspection optional via `responseStreamFinalEnabled`.
   - Non-stream responses: optional inspection/redaction on full body when enabled; response patterns evaluated similar to request stage.
6. **Collector** (`pipeline/collector.js`): stores `{ requestBody, responseBody }` while `remaining > 0`, decrementing per capture; cap 50 entries; persisted to store file.
7. **Error handling**: pipeline is fail‑open on inspection errors (proxies upstream). If upstream also fails after fail‑open, reply 502. Optional fail‑closed hook can be added if required.

---
## 8) Management APIs (`node/src/routes/management.js`)
Common: all responses `cache-control: no-store`; CORS allows `content-type` only; status codes mirror legacy behaviour.
- **/config/api**: GET returns `{ config, host, hosts, options, defaults }`; POST creates host (409 on duplicate); PATCH merges validated fields; DELETE removes non-default host; OPTIONS enumerates verbs.
- **/config/api/keys**: CRUD API keys with shape `{ id, name, key, blockingResponse, created_at, updated_at }`; `blockingResponse` sanitized to `{status 100-999, contentType, body}` with default 200 JSON blocking body.
- **/config/api/patterns**: CRUD patterns with shape `{ id, name, context, apiKeyName, paths, matchers, notes, created_at, updated_at }`.
  - `context ∈ request|response|response_stream` (alias `response-stream`).
  - `paths` required unless `context=response_stream` (then forced empty).
  - `matchers` required unless `context=response_stream`; each matcher needs at least one of `equals|contains|exists`.
  - `apiKeyName` must reference existing API key; `name` unique per context.
- **/collector/api**: GET exposes `{ total, remaining, entries }`; POST `{ action:"clear" }` resets; POST `{ count:int }` sets remaining (clamped ≤50); OPTIONS present.

---
## 9) Streaming Behaviour (`node/src/pipeline/streaming.js`)
- Detects `text/event-stream` or presence of `data:` lines.
- Parses JSON per SSE frame; supports OpenAI-like schemas (`choices[0].delta.content`, `choices[0].message.content`, `response.output[0].content[0].text`).
- Assembled text chunked with size/overlap defaults from config; each chunk wrapped as `{ "message": { "content": chunk } }` before inspection so JSON paths remain valid.
- Final inspection on full assembled text when `responseStreamFinalEnabled=true` or when streaming is disabled.

---
## 10) Logging & Telemetry
- Pino logger emits JSON with request correlation; lower_snake_case fields for pattern results, outcomes, api_key_name, pattern_id, timings.
- Header override `X-Sideband-Log` can raise verbosity (`debug|info|warn|err`) per request.
- Access-style summaries logged at request completion; warnings emitted for disabled redaction with parallel mode or invalid configs.

---
## 11) Operational Commands
- **Dev**: `cd node && npm run dev` (HTTP 11434, HTTPS 443 if cert/key exist).
- **Prod**: `HTTP_PORT=11434 HTTPS_PORT=11443 node src/server.js` (set env for origins/bearer/paths as needed).
- **Tests**: `cd node && npm test` (Vitest). Smoke: `tests/smoke/node-shadow.sh`.
- **Docker**: build with `docker build -t sorinboiaf5/f5-ai-connector:latest .`; run with `-p 11434:11434 [-p 11443:11443] [-p 10000:10000]` plus relevant env vars.

---
## 12) Behavioural Invariants
- `__default__` host cannot be removed; host resolution order is deterministic (§5).
- Parallel forwarding is automatically disabled when request redaction is enabled; streaming responses are never mutated.
- Guardrails outcomes: `flagged` or `redacted` without applied matches → block with blockingResponse; `redacted` with applied matches → masked body forwarded; `cleared` → passthrough.
- Collector cap is 50 entries; `remaining` decrements atomically per capture attempt.
- MITM CA endpoints return 404 until files exist; always served with `cache-control: no-store`.

---
## 13) File Inventory (authoritative sources)
- `node/src/server.js` — process bootstrap + HTTP/HTTPS listeners + store watcher.
- `node/src/routes/static.js` — UI + MITM downloads.
- `node/src/routes/management.js` — management API handlers.
- `node/src/routes/proxy.js` — `/api/tags` bypass + catch‑all pipeline registration.
- `node/src/pipeline/*.js` — inspection, redaction, streaming, collector, Guardrails client utilities.
- `node/src/config/*.js` — env loading, validation, persistence helpers.
- `node/src/logging/logger.js` — Pino logger factory with request decorators.
- `node/var/guardrails_config.json` — default persisted store (mutable at runtime).
- `html/` — UI bundle served by static routes.
- `certs/` — sample/self-signed certs for optional HTTPS listener.
- `mitmproxy.py` — mitmdump addon for optional MITM sidecar.
- `Dockerfile` — Node-only runtime image; starts mitmdump + Node server.
