# Repository Guidelines

## Project Structure & Module Organization
Keep NGINX configuration under `conf.d/`. 
The primary reverse-proxy logic lives in `conf.d/guardrails_connector.conf`, which wires Calypso Guardrails into upstream routing. 
All JavaScript executed by QuickJS is under `njs/`; `sideband.js` owns request/response inspection, while `utils.js` stores shared helpers. 
Place future helpers alongside the existing modules, and favor small, focused files.

## Specification (SPEC.md)
- `SPEC.md` lives at the repository root and is the canonical, implementation-level contract for this connector. It describes every endpoint, header map, shared-dict key, pipeline behaviour, defaults, and invariants.
- **When adding or changing features/behaviour**, you must update `SPEC.md` in the same change set so the spec and code never drift. Treat spec updates as mandatory acceptance criteria for feature work and fixes.
- **How to use it**: read it first to understand current behaviour; update the relevant sections (API field reference, pipeline flow, invariants) whenever you modify code paths. Reviewers should reject changes that lack corresponding SPEC updates.

## Migration Plan (MIGRATION.md)
- `MIGRATION.md` tracks the Node.js migration plan. Every migration-related change set must update this file with current phase status, decisions, and deltas from the plan.
- Before starting migration work, read `MIGRATION.md` to align on scope and locked decisions; keep it in sync as phases progress or reprioritize.
- Pull requests touching migration tasks should reference the relevant plan items and note any drift or risks.

## Build, Test, and Development Commands
Validate configuration changes with `nginx -t -c /etc/nginx/nginx.conf`; it catches syntax issues before reloads. 
After a successful check, apply updates with `nginx -s reload`. 
For script sanity, run `njs -n QuickJS -p njs -m <script>`
Use `curl -H "Content-Type: application/json" --data @payload.json https://127.0.0.1:11434/api/chat` for end-to-end smoke tests against the local proxy.
After doing any changes you need to take action and verify them by reloading the nginx config doing curl commnads.
The Docker image built from this repo is published/tagged as `sorinboiaf5/f5-ai-connector:latest`; run with `-p 11434:11434 -p 11443:11443 -p 10000:10000` and optional `-e MITM_TARGETS=...` to enable the mitm sidecar.
The UI now exposes "MITM Certificates" download buttons (PEM and CER) under Scan Configuration; files are served from `/config/mitm/` (backed by `/var/lib/mitmproxy/`) and appear after mitmdump generates its CA.


For example when you try that all is working you need to trigger a request and inspect the logs. Bellow is an example of a request that you can try.
```
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.1:8b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Write me a haiku about open-source AI." }
  ],
  "stream": false
}'


```


## Coding Style & Naming Conventions
JavaScript files use two-space indentation and trailing commas only where ECMAScript modules require them (none today). 
Use `camelCase` for variables, `UPPER_SNAKE_CASE` for constants derived from NGINX variables, and function names that read as verbs (e.g., `callSideband`). 
Log field names stay `lower_snake_case` to align with existing telemetry. Keep comments high-level—explain intent, not mechanics.

## Testing Guidelines
There is no formal test harness yet; prioritize targeted CLI checks. 
When adding helpers, supply an inline QuickJS snippet or dedicated script under a future `njs/tests/` directory and run it with `njs -q`. 
Capture representative request/response bodies in fixtures, and verify both blocked and pass-through flows with `curl` smoke tests. 
Document manual scenarios in commit messages until automated coverage lands.
- All automated and manual test plans live under `tests/`; `tests/README.md` is the source of truth for what the tests cover and the required config/fixtures. Whenever you add or change tests, update `tests/README.md` in the same change set so it stays accurate.

## Commit & Pull Request Guidelines
Adopt Conventional Commit prefixes (`feat:`, `fix:`, `chore:`) so automation can group changes once CI is introduced. 
Each commit should focus on one logical change and must leave `nginx -t` clean. 
Pull requests should reference related tickets, summarize configuration impacts, and include screenshots or logs of guardrail decisions when behaviour changes. 
Always note whether credentials or endpoints were adjusted so reviewers can update secrets.

## Security & Configuration Tips
Store Calypso API tokens in NGINX variables or external secret managers—never commit live keys. 
Double-check that any new endpoints respect the inspection mode toggles (`both`, `request`, `response`, `off`). 
When adding upstreams, gate them through the guardrail middleware unless explicitly exempted, and document the rationale in configuration comments.
