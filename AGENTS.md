# Repository Guidelines

## Project Structure & Module Organization
- Primary runtime is the Fastify-based proxy in `node/src/server.js`; request/response/stream inspection lives under `node/src/pipeline/` with shared config/helpers in `node/src/config/` and `node/src/utils/`. The forward proxy listener is implemented in `node/src/forwardProxy.js`.
- HTTP/HTTPS data-plane entrypoints default to ports 22080/22443 (certs in `certs/`); the management UI/APIs are served separately on port 22100. Static UI assets are served from `html/`. Runtime config persistence uses `var/guardrails_config.json` by default. Forward proxy listens on port 10000 and only allows destinations present in the config store.
- Legacy MITM sidecar assets remain in the repo but are no longer started; forward proxying is handled in-process by Node.
- Tests and smoke flows live in `tests/`; keep fixtures and scripts there and align coverage notes in `tests/README.md` when you add or change cases.

## Specification (SPEC.md)
- `SPEC.md` at the repo root is the authoritative contract for the Node connector: endpoints, headers, pipeline stages, shared stores, defaults, and invariants.
- **Any behaviour change requires a matching `SPEC.md` update in the same change set.** Keep the spec in lockstep with implementation and tests.
- Read it first before modifying flows; reviewers should reject changes that drift from or omit spec updates.

## Migration Plan (MIGRATION.md)
- `MIGRATION.md` chronicles the cutover from NGINX+njs to the current Fastify/Node service; migration phases 1–8 are complete and rollback requires checking out pre-cutover commits.
- If you touch remaining migration follow-ups (integration/perf validation, release artefacts, observability), update status and notes in `MIGRATION.md` alongside the code.

## Build, Test, and Development Commands
- Install and run locally: `cd node && npm install`, then `npm run dev` (data HTTP 22080; data HTTPS 22443 when `HTTPS_CERT`/`HTTPS_KEY` are present; management HTTP 22100). Use `npm start` for production-mode runs.
- Unit tests: `cd node && npm test` (Vitest). Smoke tests: `tests/smoke/node-shadow.sh` spins up stubs and exercises pass/block/redact/stream flows.
- Docker (Node-only): `docker build -t sorinboiaf5/f5-ai-connector:latest .` then `docker run --rm -p 22080:22080 -p 22443:22443 -p 22100:22100 -p 10000:10000 -e BACKEND_ORIGIN=... -e SIDEBAND_URL=... -e SIDEBAND_BEARER=... sorinboiaf5/f5-ai-connector:latest`. Forward proxy is enabled by default on port 10000; disable with `FORWARD_PROXY_ENABLED=false` if not needed.
- Quick smoke via curl (proxy path):
```bash
curl http://localhost:22080/api/chat -H "content-type: application/json" -d '{
  "model": "llama3.1:8b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Write me a haiku about open-source AI." }
  ],
  "stream": false
}'
```
Inspect Node logs (stdout) for guardrail decisions; swap to `https://localhost:22443` when HTTPS is configured. Management UI/API live on `http://localhost:22100`.

## Coding Style & Naming Conventions
- JavaScript/Node uses ES modules with two-space indentation. Keep log field names in `lower_snake_case` for telemetry parity; use `camelCase` for variables/functions and `UPPER_SNAKE_CASE` for constants.
- Functions should read as verbs (e.g., `buildProxy`, `runPipeline`). Keep comments high-level and intent-focused.
- Configuration comes from environment variables or the persisted config store; never hard-code secrets.

## Testing Guidelines
- Prefer targeted unit coverage with Vitest for new helpers or pipeline branches. Add fixtures where behaviour depends on request/response bodies.
- Document any manual or smoke scenarios in `tests/README.md` when you add or modify tests or scripts.
- Ensure new endpoints or pipeline toggles are exercised in smoke scripts when practical.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes (`feat:`, `fix:`, `chore:`). Each commit should keep `npm test` green.
- PRs should cite relevant spec/migration items, summarize behavioural impacts, and include logs or evidence of guardrail decisions when behaviour changes.

## Security & Configuration Tips
- Store Calypso/Guardrails tokens in environment variables or external secret managers; do not commit live keys.
- New routes should pass through the inspection pipeline unless explicitly exempted and documented in `SPEC.md` with rationale.
- Respect inspection mode toggles (`both`, `request`, `response`, `off`) and ensure forward-proxy allowlists remain least-privilege and documented.
