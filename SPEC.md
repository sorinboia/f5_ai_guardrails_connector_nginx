# F5 AI Guardrails Connector — System Specification (Overview)

This document provides a product-level view of the F5 AI Guardrails Connector. It summarizes the components that make up the system and how they fit together. Detailed behaviour for each tier lives in dedicated specs:

- `SPEC_BACKEND.md` — Fastify proxy, forward proxy, inspection pipeline, management APIs, persistence, and operational commands.
- `SPEC_FRONTEND.md` — Management UI behaviour, routes, data contracts, and build/runtime expectations.

Any change that affects runtime behaviour, APIs, persistence, or UI flows must update the relevant tier spec and keep this overview accurate.

---
## 1) Scope & Components
- **Data-plane proxy (backend)**: Node/Fastify service that inspects and forwards HTTP(S) traffic to configurable upstreams, applying Guardrails request/response processing. Also exposes management APIs and static assets. See `SPEC_BACKEND.md`.
- **Forward proxy**: In-process HTTP/HTTPS proxy on port `10000` that enforces a host allowlist and routes through the same inspection pipeline. Documented in `SPEC_BACKEND.md`.
- **Management UI (frontend)**: React/Tailwind SPA served from the management listener (`/config/ui` base path) for editing hosts, API keys, pattern rules, collector settings, and monitoring scaffolds. See `SPEC_FRONTEND.md`.
- **Persistence**: JSON config store on disk (`var/guardrails_config.json` by default) shared across the backend and UI. Shape and validation rules are defined in `SPEC_BACKEND.md`.

---
## 2) Runtime Topology (high level)
- **Listeners**: management/UI HTTP on `22100`; data-plane HTTP on `22080`; optional data-plane HTTPS on `22443` when cert/key are present; forward proxy on `10000` when enabled.
- **Entrypoints**: `node/src/server.js` boots management + data-plane listeners and watches the config store; `node/src/forwardProxy.js` starts the forward proxy when enabled.
- **Static assets**: built UI artifacts are served from `html/` via management routes; TLS materials live under `certs/`.
- **Deployment**: Runs via `npm start` inside the `node/` workspace or the published Docker image. Environment flags control ports, upstream origins, TLS, and proxy toggles (see `SPEC_BACKEND.md`).

---
## 3) Interfaces (summary)
- **Data plane**: catch-all proxy that inspects requests/responses before forwarding to the configured backend origin. Behaviour, headers, and pipeline stages are defined in `SPEC_BACKEND.md`.
- **Management APIs**: `/config/api*`, `/collector/api`, and supporting download/upload routes for the config store. Full request/response contracts live in `SPEC_BACKEND.md`.
- **UI**: SPA mounted at `/config/ui` (and legacy aliases) that consumes the management APIs. Route map and UX contracts are in `SPEC_FRONTEND.md`.
- **Forward proxy**: accepts absolute-form HTTP and `CONNECT` on port `10000`, enforcing destination allowlists. Details in `SPEC_BACKEND.md`.

---
## 4) Configuration & State (cross-cutting)
- **Environment**: All critical runtime switches (ports, origins, TLS paths, proxy toggles, sideband endpoints, CA bundle, log level) are read from environment variables; defaults are defined in `node/src/config/env.js` and restated in `SPEC_BACKEND.md`.
- **Config store**: Shared JSON file tracks hosts, hostConfigs, API keys, patterns, and collector state. It must always include a `__default__` host entry. Persistence and validation rules are unchanged regardless of UI or API client.
- **Secrets**: API keys, bearer tokens, and TLS keys must only be supplied via environment variables or external secret injection. The UI never stores secrets beyond the current session; the backend never hard-codes credentials.

---
## 5) Security & Compliance (system-wide)
- **Host allowlists**: Forward proxy only permits destinations already present in the config store. Missing hosts return `403` before tunnelling/forwarding.
- **TLS**: HTTPS listener serves static certs by default or issues per-host certs when dynamic MITM is enabled. Cert/key paths are configurable via environment variables.
- **Logging**: JSON logs use lower_snake_case fields and can be elevated per request via headers; see backend spec for precise behaviour. UI currently displays planned log stream filters only; live log streaming is pending.

---
## 6) Operational Notes
- **Local dev**: `cd node && npm install && npm run dev` starts management + data-plane listeners (HTTPS when certs exist). UI dev server can be run alongside with `scripts/dev-all.sh` or `cd ui && npm run dev` (see frontend spec for details).
- **Testing**: Backend unit tests use Vitest (`cd node && npm test`). Smoke flows live under `tests/` and should be updated when pipeline or API behaviour changes.
- **Docker**: `docker build -t sorinboiaf5/f5-ai-connector:latest .` produces a runtime image with ports exposed as above. Forward proxy is enabled by default; disable via `FORWARD_PROXY_ENABLED=false`.

---
## 7) Document Ownership
- Keep this overview synchronized whenever component responsibilities, ports, or cross-cutting behaviours change.
- Update `SPEC_BACKEND.md` for any backend/runtime/pipeline/API change.
- Update `SPEC_FRONTEND.md` for any UI flow, route, or API-consumption change.
- Behavioural changes without matching spec updates should be considered incomplete.
