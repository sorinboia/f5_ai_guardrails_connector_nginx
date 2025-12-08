# F5 AI Guardrails Node Connector — Technical Specification

This document is the canonical contract for the Node.js Fastify service that now replaces the legacy NGINX+njs stack. It defines every endpoint, header, shared store, pipeline behaviour, defaults, and invariants required to recreate the deployment.

---
## 1) Runtime Topology
- **Entrypoint**: `node/src/server.js` starts two Fastify instances: management/UI on HTTP port `22100` and the data plane proxy on HTTP `22080` plus (when cert/key exist) HTTPS `22443`. TLS assets default to `../certs/sideband-local.crt|key` so the repo-local certs are used by default. When `DYNAMIC_CERTS_ENABLED=true` and `MITM_CA_CERT`/`MITM_CA_KEY` are provided, the HTTPS listener issues per-host leaf certificates on the fly using the supplied CA; otherwise it serves the static cert.
- **Static assets**: Served from `/etc/nginx/html` by `node/src/routes/static.js` (`scanner-config.html` + `/config/css|js/*`). MITM/CA download endpoints expose the active TLS root at `/config/mitm/ca.pem` and `/config/mitm/ca.cer`; legacy mitmdump paths remain for backward compatibility.
- **Config & state**: Persisted JSON file at `var/guardrails_config.json` (path overrideable via `CONFIG_STORE_PATH`). `server.js` watches the file for hot reload and mutates the in-memory store in place so route decorators stay valid.
- **Forward proxy**: Node-owned listener on `0.0.0.0:10000` handles HTTP absolute-form requests and `CONNECT` tunnels. Destinations must already exist as hosts in the config store; unlisted hosts are rejected with `403`. Allowed targets are relayed to the local data-plane listeners (`http 22080` or `https 22443`, depending on the requested scheme) so the standard inspection pipeline runs. HTTPS CONNECT requests inherit the data-plane listener TLS behaviour (static cert by default; dynamic per-host certs when enabled).
- **Logging**: Pino logger in `node/src/logging/logger.js`; log level from env `LOG_LEVEL` (default `info`) or per-request overrides. Logs emit lower_snake_case fields consistent with previous telemetry.
- **Logging**: Pino logger in `node/src/logging/logger.js`; base level from env `LOG_LEVEL` (default `info`). Effective level is resolved per request from the host config `logLevel` (inherit from `__default__`) and can be overridden via `X-Sideband-Log` (`debug|info|warn|err`). Request loggers carry `host_log_level` when elevated so sideband decisions are visible at debug without changing process-wide level. Logs emit lower_snake_case fields consistent with previous telemetry.

---
## 2) External Interface (Ports & Routes)
- **Proxy catch‑all**: `/*` handled by `node/src/pipeline/proxyPipeline.js` via `node/src/routes/proxy.js`.
- **Bypass path**: `/api/tags` proxied directly to resolved backend origin without inspection.
- **Static/UI**: `/config/ui`, `/config/ui/keys`, `/config/ui/patterns` → `scanner-config.html`; `/config/ui/*` redirects strip trailing slash; `/collector/ui` redirects to `/config/ui`. `/config/css/*` and `/config/js/*` serve assets with `cache-control: no-store`. Served only from the management listener.
- **Management APIs**: `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api` implemented in `node/src/routes/management.js` with helpers in `node/src/config/validate.js` and `node/src/config/store.js`. Exposed only on the management listener.
- **Forward proxy listener**: HTTP/1.1 listener on `10000` accepts forward-proxy traffic and relays to local data-plane ports after allowlist validation.
- **Ports**: Management/UI HTTP `22100`; data plane HTTP `22080`; data plane HTTPS `22443` (optional); forward proxy `10000`.

### 2a) Forward Proxy Behaviour
- Accepts absolute-form HTTP requests and `CONNECT host:port` tunnels on port `10000`.
- Before tunnelling/forwarding, resolves the destination host (case-insensitive) and verifies it exists in the config store `hosts`/`hostConfigs`. Missing hosts → `403` with `forward_proxy_rejected`.
- Allowed HTTPS targets are TCP-tunnelled to the local HTTPS listener (`127.0.0.1:22443` by default); HTTP targets are proxied to `127.0.0.1:22080`. Requests keep the original `Host` header so the inspection pipeline resolves the correct host config and backend origin.
- If HTTPS is disabled (no cert/key), HTTPS CONNECTs are rejected with `503` and a plain-text error.

---
## 3) Environment & Defaults (`node/src/config/env.js`)
- `BACKEND_ORIGIN` default `https://api.openai.com`.
- `SIDEBAND_URL` default `https://www.us1.calypsoai.app/backend/v1/scans`.
- `SIDEBAND_BEARER` default empty; `SIDEBAND_UA` default `njs-sideband/1.0`; `SIDEBAND_TIMEOUT_MS` default `5000`.
- `CA_BUNDLE` default `/etc/ssl/certs/ca-certificates.crt`.
- `HTTP_PORT` default `22080`; `HTTPS_PORT` default `22443`; `MANAGEMENT_PORT` default `22100`; `HTTPS_CERT`/`HTTPS_KEY` default `../certs/sideband-local.crt|key`; HTTPS enabled only if both files exist/read.
- `DYNAMIC_CERTS_ENABLED` default `false`; when `true` and `MITM_CA_CERT`/`MITM_CA_KEY` point to readable files, the HTTPS listener issues per-host certificates signed by that CA (subject/SAN = requested host). `MITM_CERT_VALIDITY_DAYS` controls leaf lifetime (default 365 days).
- `FORWARD_PROXY_PORT` default `10000`; `FORWARD_PROXY_ENABLED` defaults to `true` (set to `false` to disable the listener).
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
- **Config inheritance**: a resolved host config inherits all fields from `__default__`; only keys overridden on the host entry differ. This keeps new/implicit hosts using the default extractor sets and modes until explicitly changed.
- **Defaults**:
  - `inspectMode=both`, `redactMode=both`, `logLevel=info`, `requestForwardMode=sequential`, `backendOrigin=env BACKEND_ORIGIN`.
  - `requestExtractors=[]`, `responseExtractors=[]`, `extractorParallel=false`.
  - Streaming: `responseStreamEnabled=true`, `responseStreamChunkSize=2048`, `responseStreamChunkOverlap=128`, `responseStreamFinalEnabled=true`, `responseStreamCollectFullEnabled=false`, `responseStreamBufferingMode=buffer`, `responseStreamChunkGatingEnabled=false`.
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
   - Streaming detection via `pipeline/streaming.js` (SSE `data:` frames or `text/event-stream`).
   - Buffering mode (`responseStreamBufferingMode`):
     - `buffer` (default) — full upstream body is buffered before any bytes are sent; blocking responses can still be emitted on streamed content.
      - `passthrough` — upstream bytes are chunked through to the client as they arrive while the connector concurrently tees the stream for inspection/logging; on a block the connector forcibly drops the client connection (bytes already sent may be partial); redaction remains disabled. When `responseStreamChunkGatingEnabled=true`, each chunk is held until the live inspection verdict returns; a block closes the client socket before that chunk is forwarded.
   - For inspection, text is assembled from SSE deltas and sliced into overlapping chunks (default 2048/128) for `response_stream` evaluation. Final inspection on assembled text is optional via `responseStreamFinalEnabled`.
   - Non-stream responses: optional inspection/redaction on full body when enabled; response patterns evaluated similar to request stage.
6. **Collector** (`pipeline/collector.js`): stores `{ requestBody, responseBody }` while `remaining > 0`, decrementing per capture; cap 50 entries; persisted to store file.
7. **Error handling**: pipeline is fail‑open on inspection errors (proxies upstream). If upstream also fails after fail‑open, reply 502. Optional fail‑closed hook can be added if required.

---
## 8) Management APIs (`node/src/routes/management.js`)
Common: all responses `cache-control: no-store`; CORS allows `content-type` only; status codes mirror legacy behaviour.
- **/config/api**: GET returns `{ config, host, hosts, options, defaults }`; POST creates host (409 on duplicate); PATCH merges validated fields; DELETE removes non-default host; OPTIONS enumerates verbs.
- **/config/api/store**: GET streams the entire persisted store (hosts, hostConfigs, apiKeys, patterns, collector) as JSON with `content-disposition` attachment; PUT replaces the store after `validateStoreShape` sanitization and responds with `{ store, host, hosts, config, defaults, options }` for the active host (defaults to `__default__` when the requested host is absent).
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
- When `responseStreamBufferingMode=passthrough`, the assembled text is still collected for inspection/logging/collector; if a `response_stream` block is triggered the client connection is dropped because bytes may already be in flight.

---
## 10) Logging & Telemetry
- Pino logger emits JSON with request correlation; lower_snake_case fields for pattern results, outcomes, api_key_name, pattern_id, timings.
- Header override `X-Sideband-Log` can raise verbosity (`debug|info|warn|err`) per request.
- Access-style summaries logged at request completion; warnings emitted for disabled redaction with parallel mode or invalid configs.

---
## 11) Operational Commands
- **Dev**: `cd node && npm run dev` (HTTP 22080, HTTPS 22443 if cert/key exist).
- **Prod**: `HTTP_PORT=22080 HTTPS_PORT=22443 MANAGEMENT_PORT=22100 node src/server.js` (set env for origins/bearer/paths as needed).
- **Tests**: `cd node && npm test` (Vitest). Smoke: `tests/smoke/node-shadow.sh`.
- **Docker**: build with `docker build -t sorinboiaf5/f5-ai-connector:latest .`; run with `-p 22080:22080 [-p 22443:22443] -p 22100:22100 [-p 10000:10000]` plus relevant env vars.

---
## 12) Behavioural Invariants
- `__default__` host cannot be removed; host resolution order is deterministic (§5).
- Parallel forwarding is automatically disabled when request redaction is enabled; streaming responses are never mutated.
- When `responseStreamBufferingMode=passthrough`, response-side blocking is enforced by closing the client socket; when `responseStreamChunkGatingEnabled=true` the connector waits for a chunk verdict before sending it so drops occur before the offending chunk leaves.
- Guardrails outcomes: `flagged` or `redacted` without applied matches → block with blockingResponse; `redacted` with applied matches → masked body forwarded; `cleared` → passthrough.
- Collector cap is 50 entries; `remaining` decrements atomically per capture attempt.
- Forward proxy only permits destinations that already exist in the config store; missing hosts return HTTP 403 to the proxy client.

---
## 13) File Inventory (authoritative sources)
- `node/src/server.js` — process bootstrap + HTTP/HTTPS listeners + store watcher.
- `node/src/forwardProxy.js` — forward-proxy listener (HTTP absolute + CONNECT) forwarding into local data-plane ports after allowlist validation.
- `node/src/routes/static.js` — UI + MITM downloads.
- `node/src/routes/management.js` — management API handlers.
- `node/src/routes/proxy.js` — `/api/tags` bypass + catch‑all pipeline registration.
- `node/src/pipeline/*.js` — inspection, redaction, streaming, collector, Guardrails client utilities.
- `node/src/config/*.js` — env loading, validation, persistence helpers.
- `node/src/logging/logger.js` — Pino logger factory with request decorators.
- `node/var/guardrails_config.json` — default persisted store (mutable at runtime).
- `html/` — UI bundle served by static routes.
- `certs/` — sample/self-signed certs for optional HTTPS listener.
- `mitmproxy.py` — legacy addon (no longer launched).
- `Dockerfile` — Node-only runtime image; starts Fastify + forward proxy in-process.
