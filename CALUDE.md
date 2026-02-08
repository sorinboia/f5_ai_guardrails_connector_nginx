# Coding Agent Handbook

Quick context for anyone making changes in this repo. Default stance: keep specs and behaviour in sync, and prefer small, tested changes over surprises.

## Read This First
- Always skim `SPEC.md`, `SPEC_BACKEND.md`, and `SPEC_FRONTEND.md` before touching code; they are the source of truth for contracts, ports, defaults, and invariants.
- Behavioural change or new API/UI surface? Update the relevant spec in the same change set.
- If something in code conflicts with a spec, assume the spec is right until clarified.

## What This Repo Contains
- Fastify-based proxy that inspects/forwards HTTP(S) traffic: main entry `node/src/server.js`; pipeline helpers under `node/src/pipeline/`; config/env/storage under `node/src/config/`; forward proxy in `node/src/forwardProxy.js`.
- React/Tailwind management UI served from the backend under `/config/ui`; source in `ui/`, built assets in `html/`.
- Config persists to `var/guardrails_config.json` (path overrideable). Forward proxy allowlist is derived from this store.

## Specs to Read First
- `SPEC.md` — system overview and document ownership rules.
- `SPEC_BACKEND.md` — authoritative for ports, endpoints, pipeline stages, env defaults, persistence, invariants.
- `SPEC_FRONTEND.md` — authoritative for UI routes, API contracts, validation, build/dev settings.
If you change behaviour or contracts, update the relevant spec(s) in the same change set.

## Runtime Topology
- Ports: data HTTP `22080`; data HTTPS `22443` when cert/key present; management/UI `22100`; forward proxy `10000` (disable via `FORWARD_PROXY_ENABLED=false`).
- TLS assets live in `certs/`; static UI served from `html/`.

## Dev & Build Commands
- Backend dev: `cd node && npm install && npm run dev` (uses env defaults; HTTPS starts when certs exist). Prod: `npm start`.
- Backend tests: `cd node && npm test` (Vitest). Smoke: `tests/smoke/node-shadow.sh`.
- UI dev: `cd ui && npm install && npm run dev` (Vite on 5173 with proxy to 22100). UI build: `npm run build`; tests: `npm test`; lint: `npm run lint`.
- Docker: `docker build -t sorinboiaf5/f5-ai-connector:latest .` then run with `-p 22080:22080 [-p 22443:22443] -p 22100:22100 -p 10000:10000` and required env vars.

## Coding Style
- JS/TS: ES modules, two-space indent, `camelCase` for vars/functions, `UPPER_SNAKE_CASE` for constants, log fields `lower_snake_case`. Keep comments intent-focused.
- Config must come from env or the store; never hard-code secrets.

## Testing & Coverage
- Add targeted Vitest coverage for new helpers/pipeline branches.
- Keep smoke scripts current when behaviour shifts; document manual/smoke steps in `tests/README.md`.
- Prefer fast, focused tests over broad mocks; wire tests should reflect real env defaults.

## Change Management
- Use Conventional Commit prefixes (`feat:`, `fix:`, `chore:`). Keep `npm test` green.
- Behavioural changes without matching spec updates should be treated as incomplete.
- Before pushing: run backend tests; run UI lint/tests if UI touched; rerun smoke if pipeline/ports changed.

## Security Notes
- Store tokens/keys via env or secret manager; do not commit live credentials.
- New routes should flow through the inspection pipeline unless explicitly exempted and documented. Keep forward-proxy allowlists minimal.
- When adding third-party calls, document hosts in allowlist logic and tighten scope.

## PR / MR Checklist
- Specs updated when behaviour changes.
- Tests/lint pass for touched areas; smoke run noted when relevant.
- Configurable values exposed via env or persisted store, never literals.
- Logs use `lower_snake_case` fields; sensitive values not logged.
- Forward proxy and inspection pipeline behaviour remains documented and covered by tests.
