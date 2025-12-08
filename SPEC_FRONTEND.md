# F5 AI Guardrails Connector — Frontend Specification

Scope: React/Tailwind single-page app that provides management UI for the connector. Served by the backend under `/config/ui` and consumes only the management/collector APIs. This file is the contract for UI routes, data contracts, build/runtime settings, and how the UI interacts with the backend.

---
## 1) Runtime & Hosting
- **Base path**: Browser router basename `/config/ui`; all routes render under this prefix. Legacy aliases `/config/ui/keys`, `/config/ui/patterns`, `/collector/ui` are redirected here by the backend.
- **Assets**: Built bundle emitted to `ui/dist` and copied/served from `html/` by backend static routes. No CDN dependencies at runtime.
- **Local dev**: `cd ui && npm install && npm run dev` starts Vite on port `5173` with `base=/config/ui/`, strictPort, and polling file watch for WSL/shared folders. Dev proxy forwards `/config/api*` and `/config/collector*` to `http://localhost:22100` to avoid CORS.
- **Build**: `npm run build` → TypeScript build + `vite build`; `npm run preview` serves the built bundle. Tests: `npm test` (Vitest/jsdom). Lint: `npm run lint`. Formatting: `npm run format:write`.

---
## 2) Dependencies & State Management
- **Framework**: React 19 + TypeScript + Vite 7; TailwindCSS for styling; Radix UI primitives and Lucide icons for components.
- **Data**: TanStack Query v5 handles caching and background refetch; optimistic mutations are used for API keys and pattern CRUD to keep lists responsive.
- **Forms & validation**: `react-hook-form` + `zod` schemas mirror backend validation for host configs, keys, and patterns. Client-side enum values must stay in sync with `SPEC_BACKEND.md` (e.g., inspect/redact/log levels, contexts, buffering modes).
- **HTTP client**: Thin wrapper around `fetch` with JSON headers and `cache-control: no-store`; base URL is computed as `new URL('/config', window.location.origin)` so the UI works whether served by Vite dev or backend static routes.

---
## 3) Route Map & UX Contracts
Router lives in `src/router.tsx` with basename `/config/ui`.

- **/monitor/logs** (default landing)
  - Presently a scaffold: filter UI for host/severity/search with copyable curl example. No live data connection yet; planned filter payload is displayed and copyable to support future log streaming.

- **/config/hosts**
  - Edits per-host inspection settings. Uses `/config/api` GET/PATCH/POST/DELETE to select/create/update/remove hosts.
  - Form fields cover inspect/redact modes, log level, forward mode, backend origin, extractor lists, streaming options, and gating flags. Options for request/response extractors are populated from pattern rules (contexts request/response/response_stream).
  - Host creation defaults to `__default__` when empty; deleting `__default__` is disabled. Reset/refresh buttons reload from server. Extractor chips can be added/removed ad hoc; validation prevents duplicates and enforces enums.

- **/config/api-keys**
  - Lists keys from `/config/api/keys` with pagination (client-side), search, and optional secret reveal toggle. Create/edit modal captures name, key, and blockingResponse `{status, contentType, body}`.
  - Uses optimistic updates for create/update/delete and toast notifications for success/failure. Names must be unique; validation aligns with backend limits (status 100–999, body optional).

- **/config/pattern-rules**
  - Manages Guardrails patterns via `/config/api/patterns`. Supports contexts `request`, `response`, `response_stream`; `paths` required except for `response_stream`; `matchers` required unless `response_stream`.
  - Table shows IDs, names, contexts, notes; modals allow create/edit with zod validation and optimistic mutations. Delete requires confirmation.

- **/system**
  - Store import/export. GET `/config/api/store` streams JSON and displays filename/size; PUT allows replacing the entire store by pasting JSON or dropping a file. Errors are surfaced inline.

- **/collector**
  - Controls the sample collector via `/collector/api`. Can set `remaining` count (clamped <=50) or clear entries; UI shows totals and current remaining.

- **Redirects**: `/keys` → `/config/api-keys`; `/patterns` → `/config/pattern-rules`; unmatched routes redirect to `/monitor/logs`.

---
## 4) Data Contracts Consumed from Backend
- **Config (GET /config/api)**: expects `{ config, host, hosts, options, defaults }`; host selector is driven by `hosts`. PATCH payloads are minimal diffs built by `buildHostPatch` (only changed fields are sent).
- **API Keys**: `ApiKey` shape `{ id, name, key, blockingResponse, created_at, updated_at }`; UI redacts keys in lists (`abc***xyz`). Blocking response defaults mirror backend defaults.
- **Patterns**: `PatternRule` `{ id, name, context, apiKeyName, paths, matchers, notes, created_at, updated_at }`; UI enforces required fields per context and surfaces backend error messages.
- **Store download/upload**: raw JSON store as defined in `SPEC_BACKEND.md`; filename is read from `content-disposition` when present.
- **Collector**: `{ total, remaining, entries }` with `entries` rendered as a list (no mutation other than clear/set count).
- **Error handling**: Non-2xx responses are parsed as JSON when possible; UI displays `message`/`error`/`errors` fields or a generic text fallback.

---
## 5) Styling & Theming
- TailwindCSS with `tailwind-animate` and `class-variance-authority` for component variants. Design tokens are local; no global theming switch. Components favor neutral background, subtle card shadows, and compact spacing for dense forms.
- Toasts via Radix `@radix-ui/react-toast`; modal/dialogs via Radix dialog primitives. Icons from `lucide-react`.

---
## 6) Invariants & Expectations
- UI never persists secrets beyond the current session; keys are only sent to the backend over the management origin.
- Enum options (inspect/redact modes, log levels, buffering modes, contexts) must stay aligned with backend validation; update both specs and schemas together when values change.
- Host `__default__` is always present and non-deletable. Host dropdown and collector controls assume that invariant from the backend.
- Logs page is intentionally non-functional until a streaming feed is implemented; do not remove the scaffold without replacing it with a working stream or updating this spec.

---
## 7) Release & Packaging
- Build artifacts are consumed by the backend Docker image and by `node/src/routes/static.js`. Any change to build output location, `base`, or asset naming must be coordinated with the backend static-serving logic.
- Keep tests in `ui/src/__tests__` up-to-date when modifying forms, validation, or query behaviour. Document manual UI flows in `tests/README.md` when adding new features.
