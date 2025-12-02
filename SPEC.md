# F5 AI Guardrails NGINX Connector — Technical Specification

This document is the source of truth for the behaviour implemented under `/etc/nginx`. It describes every endpoint, runtime dependency, data model, and control path so the deployment can be recreated from this spec alone. File references use workspace‑relative paths (for example, `conf.d/guardrails_connector.conf`).

---
## 1) Runtime Topology
- **Core entrypoint**: `conf.d/guardrails_connector.conf` defines two HTTP servers: plaintext on port `11434` and TLS on port `443`. Both wire every unmatched request to the njs handler `sideband.handle` and serve the management UI/API under `/config/*` and `/collector/*`.
- **JavaScript engine**: `js_engine qjs` with `js_path /etc/nginx/njs/`. njs modules imported: `sideband.js`, `config_api.js`, `collector_api.js`, `api_keys_api.js`, `patterns_api.js`, `utils.js`.
- **Shared state**: `nginx.conf` creates `js_shared_dict_zone zone=guardrails_config:16m state=/var/cache/nginx/guardrails_config.json`, giving durable key‑value storage for scan config, API keys, patterns, and collector entries.
- **DNS & TLS for outbound fetch**: `conf.d/guardrails_connector.conf` sets `resolver 1.1.1.1 8.8.8.8 ipv6=off` and `js_fetch_trusted_certificate /etc/ssl/certs/ca-certificates.crt` for `ngx.fetch` in `njs/sideband_client.js`.
- **Upstream proxying**: traffic is forwarded via an internal location `/backend` that proxies to `$backend_origin_effective` (computed per request in `njs/utils.js::backendOriginVar` and cached in `r.variables.backend_origin_effective`). Host header is preserved; proxy buffering and temp files are disabled.
- **Test host override**: when `Host` equals `tests.local`, `$sideband_url` is mapped to the local stub `http://127.0.0.1:18081/backend/v1/scans` so integration tests do not call the real Guardrails service; other hosts use the default Guardrails URL.
- **Logging**: request servers log to `/var/log/nginx/sideband*.log` in `combined` format; the njs logger (`utils.makeLogger`) emits to request log context or `ngx.log`.
- **Mitm sidecar**: `mitmdump` runs alongside NGINX using `/etc/nginx/mitmproxy.py` to retarget specific domains to fixed upstream IP/port pairs. Targets come from env `MITM_TARGETS` formatted `domain=host:port[,domain=host:port...]` (scheme defaults to https; `http://` or `https://` prefixes override). If unset, it defaults to `chatgpt.com=127.0.0.1:443`. Listens on `0.0.0.0:10000`.

---
## 2) External Interface (Ports & Locations)
- **Client traffic**: any path not matched by management routes is handled by `njs/sideband.js::handle`.
- **Static UI**: `/config/ui`, `/config/ui/keys`, `/config/ui/patterns` serve `html/scanner-config.html`; `/config/css/` and `/config/js/` alias the compiled assets.
- **Management APIs**:
  - `/config/api` → `njs/config_api.js::handle`
  - `/config/api/keys` → `njs/api_keys_api.js::handle`
  - `/config/api/patterns` → `njs/patterns_api.js::handle`
  - `/collector/api` → `njs/collector_api.js::handle`
- **Redirect helpers**: `/collector/ui` redirects to `/config/ui`.
- **Bypass path**: `/api/tags` proxies directly to `$backend_origin_effective` without inspection or body mutation.
- **Internal upstream**: `/backend` (internal) receives subrequests from `sideband.handle`; `/backend$uri$is_args$args` forwards to the configured origin.
- **Auxiliary proxy**: `mitmdump` listens on TCP port `10000` and applies `mitmproxy.py` rules (no web UI).

---
## 3) Request-Scope Variables & Header Maps (`conf.d/guardrails_connector.conf`)
- `map $http_x_sideband_inspect $sideband_inspect` → accepted values `request|response|both|off`, else empty.
- `map $http_x_sideband_log $sideband_log` → `debug|info|warn|err`, else empty.
- `map $http_x_sideband_forward $sideband_request_forward` → `sequential|parallel`, else empty.
- `js_set $backend_origin_effective utils.backendOriginVar` so proxy_pass picks per-host config.
- TLS server loads `/etc/nginx/certs/sideband-local.(crt|key)`; change these to supply real certs.

---
## 4) Persistent Data Model (Shared Dict Keys) — `njs/utils.js`
- `config:hosts` → array of normalized host identifiers (lowercase). Always includes `__default__`.
- `config:host:<host>` → JSON object of scan config overrides for that host.
- `config:api_keys` → array of API key records (see §6.2).
- `config:patterns` → array of pattern records (see §6.3).
- `collector:entries` → array of captured samples (see §6.4).
- `collector:total` / `collector:remaining` → integers tracking collection quota.

All reads/writes funnel through `readSharedJson`, `writeSharedJson`, `readSharedNumber`, `writeSharedNumber`; errors are logged with `makeLogger`.

---
## 5) Scan Configuration Resolution — `njs/utils.js::readScanConfig`
- **Host resolution order**: explicit `hostOverride` arg → `X-Guardrails-Config-Host` header → `Host` header → `CONFIG_HOST_DEFAULT`.
- **Defaults** (`SCAN_CONFIG_DEFAULTS`):
  - `inspectMode=both`, `redactMode=both`, `logLevel=info`, `requestForwardMode=sequential`
  - `backendOrigin=https://api.openai.com`
  - `requestExtractors/responseExtractors=[]`, `extractorParallel=false`
  - Streaming controls: `responseStreamEnabled=true`, `responseStreamChunkSize=2048`, `responseStreamChunkOverlap=128`, `responseStreamFinalEnabled=true`, `responseStreamCollectFullEnabled=false`
- **Per-host override fields** (merged over defaults, enum-validated):
  - `inspectMode` ∈ `off|request|response|both`
  - `redactMode` ∈ `off|request|response|both` (aliases `on/true` → `both`)
  - `logLevel` ∈ `debug|info|warn|err`
  - `requestForwardMode` ∈ `sequential|parallel`
  - `backendOrigin` (must start `http://` or `https://`)
  - `requestExtractors` / `responseExtractors` (arrays of pattern IDs; first item also exposed as singular `requestExtractor` / `responseExtractor`)
  - `extractorParallelEnabled` (bool)
  - Streaming flags/chunk sizes as above
- Host lists are stored in `config:hosts`; `ensureHostInConfig`/`removeHostFromConfig` maintain membership and guard against deleting `__default__`.

---
## 6) Management APIs & Payloads
### 6.1 `/config/api` (`njs/config_api.js`)
- **GET**: returns `{ config, host, hosts, options, defaults }` where `config` is the resolved per-host config (see §5) and `hosts` is the known host list.
- **PATCH**: body JSON may include any configurable fields (§5). Host target comes from payload `host` or `X-Guardrails-Config-Host`; header must match target (except when updating `__default__`). Validation via `validateConfigPatch`; writes through `applyConfigPatch`. Returns 400 on validation errors, 500 on persistence failure, else 200 with `{ config, applied, host, hosts, options, defaults }`.
- **POST**: creates a new host entry. Requires `host`; optional `config` block validated same as PATCH. Rejects duplicates (409). On success returns 201 with new config snapshot.
- **DELETE**: deletes a non-default host. Target from body `host` or header. Clears stored config and removes host from list; returns 200 with `{ removed, host: "__default__", hosts, config }`.
- **OPTIONS**: `allow: GET, PATCH, POST, DELETE, OPTIONS`; CORS headers allow `content-type, x-guardrails-config-host`.

### 6.2 `/config/api/keys` (`njs/api_keys_api.js`)
- **Record shape**: `{ id, name, key, blockingResponse, created_at, updated_at }`.
  - `blockingResponse` sanitized to `{ status (100–999), contentType, body }`, defaults to a 200 JSON message `"F5 AI Guardrails blocked this request"` if invalid/omitted.
- **GET**: returns `{ items: [...] }` with sanitized blockingResponse.
- **POST**: requires non-empty `name` (unique) and `key`; optional `blockingResponse`. Generates `id=ak_<timestamp>_<rand>`, timestamps in ISO.
- **PATCH**: requires `id`; optional `name` (revalidated for uniqueness), `key`, `blockingResponse`. Updates `updated_at` on change.
- **DELETE**: requires `id`; removes matching entry.
- **OPTIONS**: `allow: GET, POST, PATCH, DELETE, OPTIONS`; CORS `content-type`.

### 6.3 `/config/api/patterns` (`njs/patterns_api.js`)
- **Record shape**: `{ id, name, context, apiKeyName, paths, matchers, notes, created_at, updated_at }`.
  - `context`: `request`, `response`, or `response_stream` (aliases `response-stream`).
  - `paths`: array of JSONPath-like selectors (e.g., `.messages[-1].content`), required unless `context=response_stream` (then forced to empty).
  - `matchers`: non-empty array of rules `{ path, equals?, contains?, exists? }` unless `context=response_stream` (then forced to empty). Each matcher must declare at least one of `equals|contains|exists`.
  - `apiKeyName`: must reference an existing API key record.
  - `name` unique per context; `id=pat_<timestamp>_<rand>`.
- **GET/POST/PATCH/DELETE/OPTIONS** mirror the semantics of the API keys endpoint, with validation enforcing the above constraints and preserving uniqueness within a context.

### 6.4 `/collector/api` (`njs/collector_api.js`)
- **Collector state** (`njs/collector_store.js`): quota limited to `MAX_STORED_ENTRIES=50`. Entries are `{ id, collected_at, request: { body }, response: { body } }`.
- **GET**: returns `{ total, remaining, entries }`.
- **POST**:
  - `{ "action": "clear" }` → resets totals/entries to zero.
  - `{ "count": <non-negative int> }` (or `collect`) → schedules capture of next N interactions; values above 50 are clamped to 50.
- **OPTIONS**: `allow: GET, POST, OPTIONS`; CORS `content-type`.

---
## 7) Inspection & Forwarding Pipeline — `njs/sideband.js`
### 7.1 Constants & Defaults
- Sideband service defaults: `SIDEBAND_URL_DEFAULT=https://www.us1.calypsoai.app/backend/v1/scans`, `SIDEBAND_UA_DEFAULT=njs-sideband/1.0`, `SIDEBAND_TIMEOUT_DEFAULT=5000ms`, `SIDEBAND_BEARER_DEFAULT=<placeholder token>`.
- Extraction fallbacks: `REQUEST_PATHS_DEFAULT=['.messages[-1].content']`, `RESPONSE_PATHS_DEFAULT=['.message.content']`.
- Blocking response fallback: HTTP 200 JSON body with `"F5 AI Guardrails blocked this request"`.
- Streaming: default chunk size 2048 bytes with 128-byte overlap; final inspection enabled; streaming redaction disabled.

### 7.2 High-Level Flow (per request)
1. **Resolve config** via `readScanConfig` (includes host selection, logging level, forward/redact/inspect modes, extractors, streaming flags, backend origin).
2. **Load control headers**: `X-Sideband-Inspect`, `X-Sideband-Redact`, `X-Sideband-Log`, `X-Sideband-Forward` override config values.
3. **Load API keys & patterns**: `readApiKeys` and `readPatterns`; map configured extractor IDs (`requestExtractors` / `responseExtractors`) to pattern records matching the correct context.
4. **Request body read**: prefer `r.requestText`, fallback to `r.requestBuffer`; log 512-char preview.
5. **Forward mode**:
   - `sequential` (default): inspect/redact first, then proxy upstream.
   - `parallel`: start upstream subrequest immediately and only allowed when request redaction is disabled; if redaction is later needed it is ignored and a warning is logged.
6. **Inspection stages** (`processInspectionStage`):
   - For each phase (`request`, `response`, `response_stream`), iterate extractor patterns.
   - If extractorParallelEnabled and patterns exist, all pattern inspections run in parallel but redaction is forcibly disabled for that phase.
   - Each pattern invokes `runInspectionPhase` which:
     - Builds context via `redaction.extractContextPayload`: parses JSON body, concatenates selected JSON path values (or full body for streams) and records segment offsets.
     - Chooses Guardrails API key via `selectApiKeyForPattern`: optional matcher set (`exists`/`equals`/`contains` using `utils.getPathAccessor`) must all pass; if no matchers, always run. Chooses `pattern.apiKeyName` if available; otherwise defaults to configured bearer.
     - Calls Guardrails with `callSideband` (POST JSON `{ input, configOverrides:{}, forceEnabled:[], disabled:[], verbose:false }`, auth Bearer).
     - Interprets response outcome:
       - `flagged` → block request.
       - `redacted` → if redaction enabled, apply regex matches via `redaction.collectRedactionPlan` + `applyRedactions`; if redaction disabled, block.
       - `cleared` (or empty) → continue.
       - Anything else → block with diagnostic.
7. **Upstream fetch**: `fetchBackend` issues `r.subrequest('/backend'+uri)` with original method/body/args; keeps `Host`, disables buffering/temp files.
8. **Response handling**:
   - If `responseStreamEnabled`, attempt to parse SSE chunks (`parseStreamingBody`) to assemble text for inspection; redaction is skipped when streaming to avoid mutating chunks.
   - Optional stream chunk inspection (`responseStreamCollectFullEnabled=false`): split assembled text into overlapping slices and scan each; first block wins.
   - Optional full-stream inspection (`responseStreamCollectFullEnabled=true`) or final inspection of full body when streaming is disabled or `responseStreamFinalEnabled=true`.
   - If redaction is permitted (non-streaming and enabled), modified JSON replaces `backend.body`.
9. **Collector**: `collector_store.recordSample` stores `{ requestBody, responseBody }` while `collector:remaining > 0`; decrements quota; caps at 50 entries.
10. **Return to client**: sets upstream headers/body on `r`, returns upstream status. On block, uses API-key-specific `blockingResponse` if present.
11. **Error handling**: Exceptions fall back to pass-through (fail-open) by fetching upstream; final catch returns `502` if upstream also fails. To fail-closed, uncomment the block in `sideband.js` just before the final fallback.

### 7.3 Pattern Resolution & Matching
- `resolvePattern` ensures `pattern.context` matches the inspection phase (`request`, `response`, `response_stream`), allowing `response` and `response_stream` to share when appropriate.
- Matchers evaluated in order; failures return `shouldRun=false` (skip) unless no matchers are defined.
- Logging: each pattern execution logs `pattern_result` with status; blocks/redactions log with `pattern_id` and `api_key_name`.

### 7.4 Redaction Mechanics (`njs/redaction.js`)
- Guardrails responses are expected to include `result.scannerResults[*]` with `data.type === "regex"` and `matches` (array of `[start,end]` 1-based or `{start,end}`).
- Matches are merged per extracted path and masked with `*` over the JSON string value segments. Non-string targets are skipped with warnings.
- If no overlaps occur between matches and extracted segments, redaction is considered not applied and the request/response is blocked when the Guardrails outcome was `redacted`.

### 7.5 Streaming Inspection (`response_stream` phase)
- `parseStreamingBody` detects `text/event-stream` or presence of `data:` lines; parses JSON per `data:` frame, assembling deltas from common LLM schemas (`choices[0].delta.content`, `choices[0].message.content`, or `response.output[0].content[0].text`).
- Chunked inspection slices assembled text with configurable `responseStreamChunkSize` and `responseStreamChunkOverlap`. Each chunk is wrapped as `{"message":{"content":chunk}}` before scanning so JSON paths remain valid.
- Final inspection runs on full assembled text when `responseStreamFinalEnabled=true` or when streaming is disabled.

---
## 8) Utility Functions (Behaviours to Preserve)
- **Path accessors** (`utils.getPathAccessor`): supports JSON paths like `.key`, `.arr[0]`, `.arr[-1]`; returns `{ value, set(next) }` or `undefined` if any segment is missing.
- **Mode toggles** (`utils.isModeEnabled`): accepts `both/all/on/true` as enabled, `off/false/0` as disabled, or a specific target string.
- **Normalization helpers**: `clampInteger`, `normalizeExtractorInput`, boolean coercers, host normalization (`normalizeHostName` lowercases; empty → `__default__`).
- **Safe JSON helpers**: `safeJson`, `safeJsonParse` wrap JSON ops without throwing.

---
## 9) Security & Secrets
- Guardrails bearer tokens are not persisted in code except the placeholder default. Production deployments must inject real values via NGINX variables (`map` or `set`) and avoid committing secrets. Blocking responses attached to API keys are stored in shared dict and returned verbatim to callers when a block occurs.
- All management endpoints set `cache-control: no-store`. CORS is limited to essential headers; credentials are not enabled.
- TLS is optional; provide real certs at `/etc/nginx/certs/` for port 443.

---
## 10) Operational Commands (must stay valid)
- Syntax check after changes: `nginx -t -c /etc/nginx/nginx.conf`.
- Reload after validation: `nginx -s reload`.
- njs syntax check: `njs -n QuickJS -p njs -m <script>` (e.g., `sideband.js`).
- Smoke test path: `curl -H "Content-Type: application/json" --data @payload.json https://127.0.0.1:11434/api/chat` (or the sample in AGENTS.md). Inspect `/var/log/nginx/sideband*.log` for outcomes.

---
## 11) File Inventory (authoritative sources)
- `nginx.conf` — global HTTP config, shared dict definition.
- `conf.d/guardrails_connector.conf` — server blocks, header maps, js imports, upstream proxy locations.
- `njs/sideband.js` — end-to-end inspection/redaction/forwarding pipeline.
- `njs/sideband_client.js` — Guardrails HTTP client using `ngx.fetch`.
- `njs/redaction.js` — regex match application into JSON payloads.
- `njs/utils.js` — shared dict plumbing, config normalization, logging, JSON path utilities.
- `njs/config_store.js` — helpers for API keys/patterns persistence.
- `njs/config_api.js` — scan config CRUD API.
- `njs/api_keys_api.js` — API key CRUD + blockingResponse validation.
- `njs/patterns_api.js` — pattern CRUD with context/matcher rules.
- `njs/collector_store.js` / `njs/collector_api.js` — sample capture quota and API.
- `html/` — compiled management UI assets served under `/config/ui`.
- `mitmproxy.py` — mitmdump addon redirecting configured domains to fixed upstream IP/port targets via `MITM_TARGETS`.
- `Dockerfile` — image build copying configs, njs scripts, certs, mitmdump addon, and exposing 11434/11443/10000.

---
## 12) Behavioural Invariants (acceptance criteria)
- Default host `__default__` must always exist; deletion attempts return 400.
- Parallel forwarding is automatically disabled whenever request redaction is enabled or request inspection is off; redaction never mutates streaming responses.
- A Guardrails outcome of `flagged` or `redacted` with failed redaction always blocks and returns the configured blockingResponse (API-key specific if available, else default).
- Pattern execution honors matchers; if no matcher matches, the pattern is skipped without calling Guardrails and the next pattern is evaluated.
- Collector never stores more than 50 entries and decrements `remaining` atomically per capture attempt.
- All management responses are JSON and include `cache-control: no-store`; OPTIONS verbs advertise accurate Allow headers.
- Fail-open fallback: any unexpected exception in `sideband.handle` still proxies the request upstream (unless the optional fail-closed block is activated).

---
Keep this SPEC.md aligned with code whenever behaviour changes; it is the single source of truth for the connector’s expected behaviour.

---
## 13) API Field Reference (authoritative)
### 13.1 `/config/api` (njs/config_api.js)
- **Common**: all responses `content-type: application/json`, `cache-control: no-store`.
- **Fields**
  - `host` (string, optional for PATCH; required for POST; normalized lowercase; `__default__` allowed only for GET/PATCH) — target config host.
  - `inspectMode` (`off|request|response|both`)
  - `redactMode` (`off|request|response|both`; aliases `on|true` → `both`)
  - `logLevel` (`debug|info|warn|err`)
  - `requestForwardMode` (`sequential|parallel`)
  - `backendOrigin` (string, must start `http://` or `https://`)
  - `requestExtractors`, `responseExtractors` (array of pattern IDs; first item also exposed as singular extractor)
  - `extractorParallelEnabled` (bool)
  - Streaming: `responseStreamEnabled` (bool), `responseStreamChunkSize` (int 128–65536), `responseStreamChunkOverlap` (int 0–chunkSize-1), `responseStreamFinalEnabled` (bool), `responseStreamCollectFullEnabled` (bool)
- **GET**: returns `{ config, host, hosts, options:{ enums }, defaults:SCAN_CONFIG_DEFAULTS }`.
- **PATCH**: body may include any fields above plus optional `host`; header `X-Guardrails-Config-Host` must match target. On success `200 { config, applied, host, hosts, options, defaults }`.
- **POST**: `{ host, config? }` creates a new host; rejects duplicates (`409`). Returns `201` with snapshot like GET.
- **DELETE**: body `{ host? }` or header selects host (not `__default__`). Returns `200 { removed, host:"__default__", hosts, config }`.
- **OPTIONS**: `allow: GET, PATCH, POST, DELETE, OPTIONS`; CORS headers for `content-type, x-guardrails-config-host`.

### 13.2 `/config/api/keys` (njs/api_keys_api.js)
- **Record**: `{ id, name, key, blockingResponse, created_at, updated_at }`.
  - `blockingResponse` object fields: `status` (100–999 int), `contentType` (non-empty string), `body` (string or JSON object, null → empty string). Invalid values fall back to default block response.
- **GET**: `{ items:[record...] }`.
- **POST**: requires `name` (unique), `key`; optional `blockingResponse`. Returns `201 { item }`.
- **PATCH**: requires `id`; optional `name` (revalidated for uniqueness), `key`, `blockingResponse`. Returns `200 { item, changed }`.
- **DELETE**: requires `id`; returns `200 { removed:id }`.
- **OPTIONS**: `allow: GET, POST, PATCH, DELETE, OPTIONS`; CORS `content-type`.

### 13.3 `/config/api/patterns` (njs/patterns_api.js)
- **Record**: `{ id, name, context, apiKeyName, paths, matchers, notes, created_at, updated_at }`.
  - `context`: `request|response|response_stream` (alias `response-stream`).
  - `paths`: array of non-empty strings; required unless `context=response_stream` (then forced empty).
  - `matchers`: non-empty array of objects with `path` plus at least one of `equals|string`, `contains|string`, `exists|bool`; forbidden for `response_stream`.
  - `apiKeyName`: must reference an existing API key name.
  - `name`: unique per `context`.
- **GET/POST/PATCH/DELETE/OPTIONS** mirror the keys endpoint semantics with the above validation; conflict returns `409`, unknown apiKey returns `400`.

### 13.4 `/collector/api` (njs/collector_api.js)
- **State**: `{ total:int, remaining:int, entries:[ { id, collected_at, request:{body}, response:{body} } ] }` with max 50 entries.
- **GET**: returns current state.
- **POST**:
  - `{ "action":"clear" }` → resets totals/entries.
  - `{ "count": <int> }` (or `collect`) → schedules capture of next N (clamped to 50).
- **OPTIONS**: `allow: GET, POST, OPTIONS`; CORS `content-type`.

---
## 14) JSON Path Grammar (utils.getPathAccessor)
- Path must start with `.`.
- Tokens: `.key` where `key` is `[A-Za-z0-9_]+`; optional array index suffix `[<int>]` where `<int>` may be negative (`-1` is last element).
- Entire path must be consumed; otherwise accessor is `undefined`.
- Accessor returns `{ value, set(nextValue) }` pointing to the resolved property/element. Missing keys/indices abort resolution.
- Used in:
  - Extraction: `redaction.extractContextPayload` and `utils.extractSegments`.
  - Matchers: `sideband.js::evaluateMatchers` for pattern match conditions.

---
## 15) Guardrails Outcomes & Responses
- **Outcome mapping (per `runInspectionPhase`)**
  - `flagged` → block via `blockAndReturn`; response uses API-key-specific `blockingResponse` if that key exists, else default 200 JSON message.
  - `redacted`:
    - If redaction disabled for the phase → block.
    - If redaction plan incomplete (unsupported scanners, unmatched ranges) → block with details.
    - If redaction succeeds → continue with mutated body (request/response) except streaming phases never mutate.
  - `cleared` or empty → continue.
  - Any other string → block with diagnostic `unexpected <phase> outcome`.
- **Streaming nuance**:
  - `response_stream` redactions are not applied; `redacted` outcome in streaming still blocks.
  - When streaming is enabled but `responseStreamFinalEnabled=true`, a final pass may redact the assembled body; otherwise body is untouched.

---
## 16) Streaming Behaviour Details
- Detection: `parseStreamingBody` triggers when `Content-Type` contains `text/event-stream` **or** payload contains `data:` lines.
- Parsed event payloads: expects JSON per line; extracts text from first available:
  - `choices[0].delta.content`
  - `choices[0].message.content`
  - `response.output[0].content[0].text` or `.text.value`
- Assembled text is wrapped as `{"message":{"content":<text>}}` for inspection so JSON paths remain consistent.
- Chunking: `sliceTextChunks(text, size, overlap)` ensures forward progress even when `overlap >= size` by clamping overlap to `size-1`.
- Modes:
  - `responseStreamCollectFullEnabled=true` → inspect full assembled stream once (no mutation).
  - Else chunked inspection; first blocked chunk stops processing.
  - Final inspection runs when `responseStreamFinalEnabled=true` or when streaming is disabled. Redaction applies only in non-streaming final phase.

---
## 17) Operations & Testing Checklist
1. Edit configs/scripts.
2. `nginx -t -c /etc/nginx/nginx.conf` (must succeed).
3. `nginx -s reload`.
4. Smoke test:
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
5. Inspect logs: `/var/log/nginx/sideband.error.log`, `/var/log/nginx/sideband.access.log`.
6. Optional njs lint: `njs -n QuickJS -p njs -m sideband.js` (or other module).

---
## 18) Security & Runtime Notes
- **Secrets**: Provide real Guardrails URL/token via NGINX variables or external secret manager; avoid hardcoding. `sideband_bearer` defaults are placeholders. Blocking responses stored with API keys are echoed to clients on block—populate with safe content.
- **TLS**: Replace `certs/sideband-local.(crt|key)` for production; both servers keep client bodies in memory (`client_body_buffer_size 1m`) for njs access.
- **Resolver/CA**: Outbound fetch relies on `resolver 1.1.1.1 8.8.8.8` and `js_fetch_trusted_certificate /etc/ssl/certs/ca-certificates.crt`; adjust if egress control differs.
- **Fail-closed option**: In `njs/sideband.js`, uncomment the block near the final `catch` to return a block response instead of pass-through on exceptions.
- **Parallel forwarding safety**: Auto-disabled when request redaction is active or request inspection is off; warning logged if redaction is ignored because upstream already dispatched.
