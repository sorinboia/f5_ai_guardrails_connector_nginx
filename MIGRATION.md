# Migration Plan: NGINX+njs ➜ Node.js

This plan outlines how to replace the current NGINX + njs reverse‑proxy connector with a fully Node.js service while preserving all behaviours documented in `SPEC.md` and the existing UI. Each phase lists concrete outputs and owners so work can be tracked and verified.

## Goals & Scope
- Deliver feature parity with the current connector (inspection, redaction, telemetry, config/collector APIs, UI hosting, MITM cert download, upstream routing) as defined in `SPEC.md`.
- Reduce NGINX-specific dependencies (maps, keyval, `ngx.fetch`, `njs`) by re‑implementing pipelines in Node.js.
- Keep operator-facing endpoints, headers, and defaults stable; any intentional deviations must be recorded in `SPEC.md` and release notes.
- Provide a safe cutover path with rollback to the existing NGINX stack.

## Constraints & Assumptions
- The UI bundle under `html/` must remain accessible at `/config/ui` and `/collector/ui` without behavioural changes.
- Management APIs (`/config/api`, `/collector/api`) must preserve request/response shapes, validation, and CORS behaviour.
- MITM certificate downloads continue to serve files from `/config/mitm/` backed by `/var/lib/mitmproxy/`.
- Logging semantics (field names, log levels) stay aligned with current telemetry expectations.
- Environment-driven secrets (`F5_GUARDRAILS_URL`, `F5_GUARDRAILS_TOKEN`, etc.) remain the injection mechanism.
- Deployment remains container-first; a new image will replace `sorinboiaf5/f5-ai-connector:latest` once validated.

## Current Behaviour Inventory (read/confirm in `SPEC.md` before coding)
- Reverse proxy on port 11434 with upstream block `backend_upstream`.
- Request/response inspection + redaction orchestrated by `njs/sideband.js` via `callSideband` to F5 Guardrails.
- Runtime toggles via headers: `X-Sideband-Inspect`, `X-Sideband-Redact`, `X-Sideband-Log`, `X-Sideband-Forward`.
- Default extraction paths: `REQUEST_PATHS_DEFAULT`, `RESPONSE_PATHS_DEFAULT`.
- Runtime config store: `scan_config_*` values (inspect mode, redact mode, log level, forward mode, extractor settings).
- Management APIs: `/config/api` (GET/PATCH/OPTIONS) and `/collector/api` (GET/POST/OPTIONS) including sample quotas and CORS rules.
- Sample capture + storage: collector quotas, max 50 entries, clear/count actions.
- UI: served static HTML/JS at `/config/ui`, `/collector/ui`.
- MITM cert hosting under `/config/mitm/` (PEM/CER downloads).
- Logging: structured sideband access/error logs with lower_snake_case fields.

## Target Node.js Architecture (proposed)
- **Framework**: Fastify + `@fastify/http-proxy` for streaming proxy and hookable lifecycle.
- **Guardrails client**: dedicated module wrapping axios/fetch with retries, timeouts, and metrics; mirrors `callSideband` contract.
- **Pipeline**: middleware sequence for request parse → extraction → guardrails call → decision (block/redact/forward) → upstream fetch → optional response inspection/redaction.
- **Config store**: in-memory struct seeded from env + persisted JSON/YAML file on disk; must support atomic PATCH with validation mirroring `applyConfigPatch` rules and zero-downtime live reload.
- **Collector store**: ring buffer capped at 50 entries; expose same API contract; support disk snapshot for restarts.
- **Static assets**: serve `html/` and MITM files via Fastify static plugin; ensure correct content-types and cache headers.
- **Logging**: pino/winston logger with serializers to emit existing field names and levels; ensure request correlation and error logs match current shape.
- **Config surface**: preserve header overrides; replicate `requestForwardMode` sequential/parallel behaviour using async pipeline controls.
- **Packaging**: multi-stage Dockerfile producing a minimal runtime image with healthcheck endpoint.

## Phase Plan
1) Discovery & Parity Mapping
   - Read `SPEC.md`, `conf.d/guardrails_connector.conf`, and `njs/*.js` to catalog every behaviour, default, and edge case.
   - Create a mapping doc (within this file or a new appendix) translating each NGINX/njs feature to a Node.js component.
   - Identify any NGINX-only semantics (e.g., subrequest behaviours, header casing) that need emulation.

2) Architecture Spike
   - Prototype minimal Fastify server that proxies `/api/chat` to the current upstream and streams responses.
   - Validate ability to intercept/modify streaming bodies for redaction using Fastify hooks.
   - Prove zero-downtime config reload approach (file watch + in-memory swap) and persistence to disk.

3) Core Pipeline Implementation
   - Implement Guardrails client and request/response inspection flow with the same decision matrix as `sideband.handle`.
   - Reproduce header-based overrides and request/response extractor defaults.
   - Implement redaction logic mirroring `njs/redaction.js` (regex masking, JSON path handling).
   - Implement sequential vs parallel forwarding semantics and fallbacks when redaction is enabled.
   - Add TLS termination inside Node (cert/key loading, SNI, reload without downtime).

4) Management APIs Parity
   - Rebuild `/config/api` with GET/PATCH/OPTIONS, validation, enums, and defaults identical to `SPEC.md`.
   - Rebuild `/collector/api` with GET/POST actions (`clear`, `count`) and 50-entry cap.
   - Ensure CORS headers and error codes match current behaviour.

5) Static Assets & MITM Files
   - Serve `html/` bundle at `/config/ui` and `/collector/ui` with correct redirects.
   - Serve `/config/mitm/*` files from `/var/lib/mitmproxy/` with appropriate MIME types and download headers.
   - Ensure file-permission model keeps MITM artifacts readable by the Node process only.

6) Testing & Validation
   - Unit tests for guardrails client, redaction, config validation, collector store, and pipeline decisions.
   - Integration tests reproducing current `tests/integration` coverage; update `tests/README.md`.
   - Manual smoke: `curl` scenarios from README, including block, redact, pass-through, and collector flows.
   - Performance sanity: compare latency overhead vs. NGINX baseline on sample payloads.

7) Packaging & Deployment
   - Author new Dockerfile (multi-stage) and compose/k8s manifests if applicable.
   - Add healthcheck endpoints and readiness probes.
   - Tag/publish replacement image (candidate tag before flipping `latest`).
   - Define graceful shutdown with connection draining for zero-downtime deploys.

8) Cutover Plan
   - Run Node service alongside existing NGINX on alternate ports; mirror traffic for shadow testing.
   - Compare logs/decisions between stacks; resolve deltas.
   - Switch fronting load balancer/DNS to Node service once parity confirmed.
   - Keep rollback by retaining NGINX config and images; document toggle procedure.

9) Documentation & Spec Updates
   - Update `SPEC.md` with Node-specific implementation details, defaults, and any behavioural changes.
   - Update `README.md` for new run/deploy instructions and CLI commands.
   - Add developer docs for configuration persistence, logging, and debugging.

## Subtasks (detailed backlog)
- **Current focus (Dec 2025)**  
  1) Finish Phase 3: response inspection/redaction (including streaming) and collector writes; implement sequential vs parallel forwarding with redaction constraints.  
  2) Add unit coverage for the sideband client, pattern matching, and blocking responses; define `npm test` entrypoint and initial suites.  
  3) Start integration harness parity for `/api/chat` block/redact/pass-through and streaming cases; document manual smoke steps in `tests/README.md`.
- **Phase 1 – Discovery/Parity Mapping**
  - Re-read `SPEC.md`, `conf.d/guardrails_connector.conf`, and every `njs/*.js` to confirm defaults, enums, edge cases (matchers, streaming, collector caps, fail-open path).
  - Document NGINX-only semantics to emulate (maps, buffering off, Host preservation, resolver/CA, mitm CA path differences, tests.local stub, redirect helpers).
  - Capture any gaps requiring `SPEC.md` clarifications.
- **Phase 2 – Architecture Spike**
  - Stand up Fastify app with HTTP 11434 and HTTPS 443 listeners using placeholder certs. **Done:** `node/src/server.js` boots HTTP and optional HTTPS (logs if cert/key missing).
  - Wire `/api/tags` passthrough and catch-all proxy with keepalive, no buffering/temp files. **Updated:** `/api/tags` proxy registered; catch-all now uses `@fastify/http-proxy` with upstream Host rewrite and undici streaming (no temp files). Pipeline hooks still pending.
  - Prove streaming interception (SSE chunk assembly) and a zero-downtime config reload prototype (file watch + in-memory swap). **Done:** store file watcher added in `src/server.js` for hot reload without restart; SSE chunking probe implemented in `src/pipeline/streaming.js` and wired via `onSend` in proxy routes (probe-only, non-mutating).
- **Phase 3 – Core Pipeline**
  - **Done:** Implement Guardrails client (UA `njs-sideband/1.0`, 5s timeout, CA path, tests.local override, 599-on-error parity) in Node at `src/pipeline/sidebandClient.js`; bearer selection + pattern wiring partially integrated for request inspection.
  - **Done:** Catch-all proxy now resolves `backendOrigin` per-request from the config store/host header and rewrites `Host` to that upstream; request inspection pre-handler runs before proxying and blocks on `flagged`/`redacted` sideband outcomes (no redaction applied yet; response-side inspection still pending).
  - TODO: apply redaction instead of blocking on `redacted` outcomes; implement response-phase inspection (including streaming) with path defaults and chunking; wire sequential vs parallel forwarding rules (disable redaction in parallel mode); keep fail-open then 502-on-upstream-fail semantics.
  - TODO: hook collector recording into the Node pipeline with 50-entry cap and remaining counter parity.
- **Phase 4 – Management APIs**
  - `/config/api`: GET/PATCH/POST/DELETE/OPTIONS with host precedence, validation (`validateConfigPatch` parity), enums, and `__default__` protections. **Done in Node (`src/routes/management.js` + `config/validate.js`/helpers/store).**
  - `/config/api/keys`: CRUD with name uniqueness, blockingResponse sanitization, id/timestamp formats. **Done.**
  - `/config/api/patterns`: CRUD with context rules, matcher validation, API key existence, name uniqueness per context. **Done.**
  - `/collector/api`: GET/POST with clear/count, quota clamp 50, remaining counter semantics. **Done** (re-schedule resets entries and caps to 50).
  - Apply CORS (`content-type`), `cache-control: no-store`, and status codes identical to NGINX. **Done for management routes; ensure parity for proxy responses later.**
- **Phase 5 – Static Assets & MITM**
  - **Done in Node:** `/config/ui`, `/config/ui/keys`, `/config/ui/patterns` serve `scanner-config.html` with `cache-control: no-store` plus redirects; `/config/css/*` and `/config/js/*` stream static assets via Fastify static plugin.
  - **Done in Node:** MITM CA downloads at `/config/mitm/mitmproxy-ca-cert.pem|.cer` with correct MIME, `no-store`, 404 when missing, and scheme-aware file roots (`/var/lib/mitmproxy` for HTTP, `/root/.mitmproxy` for HTTPS).
- **Phase 6 – Testing & Validation**
  - Unit tests: Guardrails client, redaction planner/applier, config validation, matcher logic, collector store, streaming parser/chunker. **Pending.**
  - Integration tests: management APIs payload/enum/uniqueness rules (**pending**); pipeline block/redact/pass-through; streaming inspection; `/api/tags` passthrough.
  - Manual smoke via curl scenarios from README; capture log snippets for parity.
- **Phase 7 – Packaging & Deployment**
  - Multi-stage Dockerfile with minimal runtime image, healthcheck endpoint, env wiring (secrets, MITM targets, CA path).
  - Compose/k8s manifests (if applicable) and readiness/liveness probes; enable graceful shutdown with connection draining.
- **Phase 8 – Cutover**
  - Run Node alongside NGINX on alternate ports; mirror traffic for shadow comparison.
  - Diff logs/decisions; resolve deltas; define rollback toggle and DNS/LB switch steps.
- **Phase 9 – Documentation**
  - Update `SPEC.md` for Node implementation details and any intentional deviations.
  - Refresh `README.md` and `tests/README.md` with new commands, env, fixtures, and manual scenarios.
  - Summarize migration status and known gaps in `MIGRATION.md` as phases complete.

## Deliverables
- Node.js service codebase with proxy pipeline, management APIs, static asset serving, logging, and collector features.
- Updated `SPEC.md`, `README.md`, and `tests/README.md` reflecting the new stack.
- Docker image and deployment artifacts ready for staging and production.
- Shadow-test report showing parity metrics and known exceptions.

## Additional Considerations
- Security hardening: request body size limits, header canonicalization, rate limiting/backpressure to avoid DoS; validate JSON payloads before processing.
- Upstream resilience: timeouts, retries with jitter, circuit breaker on Guardrails and backend calls; configurable via persisted settings.
- Config versioning/migration: schema version embedded in the persisted config file with migration steps for future changes.
- Logging/rotation: emit to stdout/stderr for container log drivers; ensure sensitive fields are redacted before logging.
- TLS assets: decide on cert source (mounted secret vs ACME); support hot reload when files change.
- Compatibility with UI caching: set cache headers to match current behaviour and avoid stale UI after redeploy.
- Performance baselines: capture latency/throughput before/after migration using representative payload sizes and streaming scenarios.
- Graceful restarts: handle SIGTERM/SIGINT by stopping new accepts and waiting for in-flight requests to finish.

## Appendix: NGINX → Node Parity Map
- **Traffic entry & routing**: NGINX serves HTTP 11434 + HTTPS 443, defaulting all unmatched paths to `sideband.handle`; `/api/tags` bypasses inspection; internal `/backend` subrequest preserves method/query and Host with buffering disabled. Node must expose the same ports/routes, include the `/api/tags` passthrough, stream bodies end-to-end, and preserve Host/keepalive while avoiding temp files/buffering.
- **Origin resolution**: `$backend_origin_effective` comes from `utils.backendOriginVar`, picking payload/`X-Guardrails-Config-Host`/Host/`__default__`, validated as http(s). Node config store must mirror this precedence, keep `__default__` undeletable, and validate URLs.
- **Header overrides**: `X-Sideband-Inspect`, `X-Sideband-Log`, `X-Sideband-Forward` are regex-mapped; invalid values fall back to config defaults. Node must parse the same enums and ignore invalid values.
- **Guardrails client**: `callSideband` uses `ngx.fetch` with UA `njs-sideband/1.0`, 5s timeout, CA bundle, and a tests-only override (`Host=tests.local` → `http://127.0.0.1:18081/backend/v1/scans`). Node client should keep UA/timeout/CA options and support the tests.local stub or equivalent toggle.
- **Inspection/redaction pipeline**: Defaults: inspect=both, redact=both, forward=sequential, request paths `.messages[-1].content`, response paths `.message.content`. Parallel mode skips request redaction; redaction disabled for streaming; pattern context/matcher semantics and blockingResponse selection must match `sideband.js` and `redaction.js`, including fail-open then 502-on-double-fail behaviour and optional fail-closed hook.
- **Streaming handling**: SSE/text-event parsing assembles deltas, slices chunks (size 2048, overlap 128), optionally final/full-stream scan; streaming redaction is off. Node must implement identical parsing, chunking, and flags (`responseStreamEnabled`, `responseStreamFinalEnabled`, `responseStreamCollectFullEnabled`).
- **Management APIs**: `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api` payloads, enums, uniqueness rules, ID formats, and status codes follow `SPEC.md`; CORS limited to `content-type`; all responses `cache-control: no-store`. Node routes must preserve shapes and validation (e.g., pattern contexts/matchers, API key name uniqueness, host CRUD rules).
- **State persistence**: Shared dict keys (`config:hosts`, `config:host:<host>`, `config:api_keys`, `config:patterns`, collector totals/entries) must map to a persisted store on disk with atomic updates and hot reload. Maintain collector cap 50 and remaining counter semantics.
- **Static assets & MITM files**: `/config/ui*` serve `html/scanner-config.html` with 302 helpers; `/config/css/` and `/config/js/` aliases; MITM CA downloads at `/config/mitm/mitmproxy-ca-cert.(pem|cer)` with correct MIME, `no-store`, and 404 until generated (paths currently `/var/lib/mitmproxy/` for HTTP server and `/root/.mitmproxy/` in the TLS block). Node must keep endpoints, cache headers, and content-types consistent.
- **Logging**: NGINX emits combined access logs; njs logger uses lower_snake_case fields and honours log level overrides. Node logger should produce equivalent fields/levels and tie logs to request IDs for parity comparisons.
- **NGINX mechanics to emulate**: `proxy_request_buffering off`, `proxy_buffering off`, `proxy_max_temp_file_size 0`, `proxy_http_version 1.1`, `Connection ""` (upstream keepalive), `client_body_buffer_size 1m`, `subrequest_output_buffer_size 8m`, resolver + trusted CA for outbound fetch, and regex `map` behaviour (invalid header values drop to empty). Maintain redirect aliases (`/config/ui/…` → `/config/ui`) and default fail-open posture.

## Implementation Sketch (Node)
- **Fastify routing/layout**: two servers (HTTP 11434, HTTPS 443) sharing handlers; root `*` proxy with onRequest → body capture (limit 1m) → config resolution (host header/override) → header override parsing → optional request inspection/redaction → upstream proxy via `@fastify/http-proxy` (keepalive, no buffering/temp files) → response inspection. Add `/api/tags` direct proxy route (no hooks). Management routes `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api` implemented as Fastify handlers with CORS and `cache-control: no-store`. Static routes for UI and MITM downloads with 302 helpers.
- **Guardrails client**: module wrapping fetch/axios with UA `njs-sideband/1.0`, default timeout 5s, trusted CA path, optional stub when `Host=tests.local` (config flag/env to mirror map). Accept bearer from patterns/API keys, honor per-request overrides. Retry/backoff optional but must default to current single-attempt behaviour.
- **Config & collector store**: JSON file (e.g., `var/guardrails_config.json`) holding `hosts`, per-host configs, api keys, patterns, collector totals/entries. Load on boot; keep in-memory cache; writes are atomic (temp file + rename) with version counter. File watcher triggers hot reload; validation mirrors `validateConfigPatch`. Keep `__default__` sentinel. Collector enforces cap 50 and remaining counter semantics; persist after each mutation.
- **Pipeline/parity details**: implement `isModeEnabled` semantics, matcher evaluation, pattern context rules, sequential vs parallel forward with redaction constraints, streaming parse/chunk defaults (2048/128) with redaction disabled during streaming, fail-open primary error path then 502 on upstream failure, optional fail-closed toggle. Support per-API-key `blockingResponse` with sanitization.
- **TLS**: load cert/key from configurable paths (default `/etc/nginx/certs/sideband-local.crt|.key`); support hot reload on file change; client TLS to upstream should respect CA bundle and SNI.
- **Logging**: pino/winston with serializers to emit lower_snake_case fields; include request id and pattern/api_key metadata; log level overridable by header/config. Export access-style summary logs for parity comparisons.

## Decisions (locked from prior open questions)
- Framework choice: **Fastify selected** for streaming and performance.
- Config persistence: **Persist config to disk** with in-memory cache and hot reload for zero downtime.
- Reload semantics: **Zero-downtime config changes required**; implement live reload without restarts.
- TLS: **Move TLS termination into Node**; NGINX no longer fronts TLS.
- Observability: **No additional observability stack planned now** beyond structured logging.
