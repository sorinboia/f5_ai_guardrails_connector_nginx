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

## Decisions (locked from prior open questions)
- Framework choice: **Fastify selected** for streaming and performance.
- Config persistence: **Persist config to disk** with in-memory cache and hot reload for zero downtime.
- Reload semantics: **Zero-downtime config changes required**; implement live reload without restarts.
- TLS: **Move TLS termination into Node**; NGINX no longer fronts TLS.
- Observability: **No additional observability stack planned now** beyond structured logging.
