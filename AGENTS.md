# Repository Guidelines

## Project Structure & Module Organization
Keep NGINX configuration under `conf.d/`. The primary reverse-proxy logic lives in `conf.d/guardrails_connector.conf`, which wires Calypso Guardrails into upstream routing. All JavaScript executed by QuickJS is under `njs/`; `sideband.js` owns request/response inspection, while `utils.js` stores shared helpers. Place future helpers alongside the existing modules, and favor small, focused files.

## Build, Test, and Development Commands
Validate configuration changes with `nginx -t -c /etc/nginx/nginx.conf`; it catches syntax issues before reloads. After a successful check, apply updates with `nginx -s reload`. For script sanity, run `njs -c njs/sideband.js` to confirm QuickJS compatibility, and `njs -q njs/utils.js 'export { safeJson }'` (adjust exports as needed) to exercise specific functions. Use `curl -H "Content-Type: application/json" --data @payload.json http://127.0.0.1/chat` for end-to-end smoke tests against the local proxy.

## Coding Style & Naming Conventions
JavaScript files use two-space indentation and trailing commas only where ECMAScript modules require them (none today). Use `camelCase` for variables, `UPPER_SNAKE_CASE` for constants derived from NGINX variables, and function names that read as verbs (e.g., `callSideband`). Log field names stay `lower_snake_case` to align with existing telemetry. Keep comments high-level—explain intent, not mechanics.

## Testing Guidelines
There is no formal test harness yet; prioritize targeted CLI checks. When adding helpers, supply an inline QuickJS snippet or dedicated script under a future `njs/tests/` directory and run it with `njs -q`. Capture representative request/response bodies in fixtures, and verify both blocked and pass-through flows with `curl` smoke tests. Document manual scenarios in commit messages until automated coverage lands.

## Commit & Pull Request Guidelines
Adopt Conventional Commit prefixes (`feat:`, `fix:`, `chore:`) so automation can group changes once CI is introduced. Each commit should focus on one logical change and must leave `nginx -t` clean. Pull requests should reference related tickets, summarize configuration impacts, and include screenshots or logs of guardrail decisions when behaviour changes. Always note whether credentials or endpoints were adjusted so reviewers can update secrets.

## Security & Configuration Tips
Store Calypso API tokens in NGINX variables or external secret managers—never commit live keys. Double-check that any new endpoints respect the inspection mode toggles (`both`, `request`, `response`, `off`). When adding upstreams, gate them through the guardrail middleware unless explicitly exempted, and document the rationale in configuration comments.
