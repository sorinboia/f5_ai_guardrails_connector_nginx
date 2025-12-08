# New Management UI Plan (React + shadcn/ui + Tailwind)

## Objectives & Scope (v1)
- Replace the legacy `html/` UI with a modern SPA that feels professionally designed and is easy to extend.
- Use React 18, TypeScript, Tailwind, and shadcn/ui for component primitives and theming.
- Preserve existing management entrypoints (`/config/ui`, `/config/ui/keys`, `/config/ui/patterns`) while enabling deep-linkable routes for Monitor, Config, and System sections.
- Support all current management workflows: host configuration, API key CRUD, pattern rule CRUD, config export/import, MITM cert download. Monitor/Logs ships with an empty state but a scaffold for future streaming log views.
- Keep behaviour consistent with `SPEC.md` and management APIs; no backend changes to business logic in v1 other than static-asset serving adjustments.

## Non-Goals (v1)
- No real-time log streaming backend changes (front-end only placeholder scaffolding).
- No redesign of API schemas or pipeline behaviour.
- No auth/SSO layer (reuse current unauthenticated management access model).

## Tech Stack & Tooling Decisions
- Build: Vite + React 18 + TypeScript; package manager `npm` to align with existing Node tooling.
- Styling: Tailwind CSS with shadcn/ui (radix-based) components; class-variance-authority for variants; lucide-react icons.
- State & data: React Router for client routing; @tanstack/react-query for data fetching/caching; react-hook-form + zod for typed forms and validation.
- UI utilities: Tailwind CSS variables for color tokens; `tailwind-merge`/`clsx` helpers; shadcn toast for feedback.
- Testing: Vitest + React Testing Library for key form flows (submit payload shape, validation errors) and critical rendering (sidebar/nav shell).
- Lint/format: eslint + prettier configs co-located in `ui/`; reuse repo-level Node .editorconfig if present.

## Project Layout (new `ui/` workspace)
- `ui/package.json` — scripts: `dev`, `build`, `preview`, `lint`, `test`, `format`.
- `ui/index.html` — Vite entry; outputs to `ui/dist`.
- `ui/src/` structure:
  - `app.tsx` — router + providers (QueryClientProvider, Theme provider if needed).
  - `main.tsx` — Vite bootstrap.
  - `routes/` — route components (monitor, logs, config, host-config, api-keys, pattern-rules, system).
  - `layouts/` — `AppShell` (sidebar + header), `Content` wrappers.
  - `components/ui/` — shadcn generated primitives (button, card, form, input, select, table, sheet, tooltip, tabs, toast, dialog, drawer, breadcrumb, badge, skeleton, empty-state block).
  - `components/shared/` — composables like `PageHeader`, `SectionCard`, `ConfirmDialog`, `DataTable`, `KeyValueList`, `FormActions`, `EmptyState`, `FileDropzone`.
  - `features/` — domain-specific modules:
    - `hosts/` (host list + editor drawer + defaults banner),
    - `api-keys/` (table + modal),
    - `patterns/` (filters + form),
    - `system/` (cert download tiles + config import/export),
    - `monitor/` (placeholder log stream scaffolding),
    - `collector/` (count controls if we surface them).
  - `lib/api/` — fetch wrappers per management endpoint, response/DTO types, transformers between API and form models.
  - `lib/hooks/` — `useActiveHost`, `useToastError`, `useConfirm`, query keys.
  - `lib/types/` — shared TypeScript types mirroring `SPEC.md` (HostConfig, ApiKey, Pattern, CollectorStore, BlockingResponse, StoreSnapshot).
  - `lib/constants/` — enums, default values, route definitions, color tokens.
  - `styles/` — `globals.css`, Tailwind base, shadcn CSS vars; font-face declarations.
  - `config/` — tailwind config, postcss, shadcn config, tsconfig, vite.config.
- Build output integration: `npm run build:ui` at repo root will run `cd ui && npm run build` then copy `ui/dist` into root `html/` (replacing legacy assets). Static route in Node will be pointed to `html/` (or `html/dist`) with SPA fallback for `/config/ui/*`.

## Visual & UX Direction
- Typography: primary "Plus Jakarta Sans" (or "Space Grotesk" if unavailable) via Google Fonts; secondary mono for code snippets.
- Palette: light-first theme using soft neutrals (#F5F5F4 bg, #FFFFFF surfaces, #E5E7EB borders) with F5 crimson accent (#E31735) and charcoal text (#0F172A); secondary accent teal (#0EA5E9) for success/links; warning accent amber (#F59E0B). Provide dark-mode tokens later.
- Spacing: 8px grid, generous whitespace, 12px radius for surfaces, 1px hairline borders using translucent slates.
- Components: cards with subtle inset shadows, focus rings using accent; consistent iconography via lucide.
- Feedback: toasts for successes/errors; inline validation on forms; empty states with icon + call-to-action; branded empty-state illustrations using F5 mark (red circle with white “f5”).

## Navigation & Routing Plan
- React Router nested routes under `/config/ui/*` to keep existing entry URL working; redirects for `/config/ui`, `/config/ui/keys`, `/config/ui/patterns` to new routes.
- Sidebar sections (accordion style with section labels):
  - Monitor → Logs
  - Config → Host Config, API Keys, Pattern Rules
  - System → System, Collector
- AppShell includes: sidebar (collapsible on mobile), top bar with page title + host selector quick access, optional status pill (backend origin/active host), user help menu (link to SPEC?)
- Breadcrumbs within content area for context (e.g., Config / Host Config / __default__).

## Feature Specifications
### Monitor / Logs (initial empty)
- Page shows an empty state with CTA explaining logs will surface pipeline decisions once backend streaming is added.
- Include placeholder filters (host selector, severity select, search input) wired to local state only; ready to connect to future `/logs` stream.
- Provide a "Copy curl" helper showing how to hit `/config/api` (educational placeholder).

### Config / Host Config
- Host picker sourcing `hosts` list from `/config/api` GET; default selection `__default__`.
- Create host: modal/drawer with host name input + clone-from-default toggle; POST `/config/api` (host parameter) then refetch hosts and select new host.
- Delete host: disallow `__default__`; confirmation dialog; DELETE `/config/api?host=name`.
- Edit host config: form bound to merged config (defaults + overrides). Fields mapped to SPEC defaults/enums: `inspectMode`, `redactMode`, `logLevel`, `requestForwardMode`, `backendOrigin`, `sid‌​eband` timeouts, extractor arrays, streaming toggles (`responseStreamEnabled`, `responseStreamChunkSize`, `responseStreamChunkOverlap`, `responseStreamFinalEnabled`, `responseStreamCollectFullEnabled`, `responseStreamBufferingMode`, `responseStreamChunkGatingEnabled`).
- Validation: zod schemas enforcing enums and numeric ranges; frontend mirrors `validate.js` rules (e.g., chunk sizes >0, URLs http(s)).
- Save via PATCH `/config/api?host=name` sending only dirty fields (diff against defaults to avoid noisy overrides); show summary of inherited vs overridden settings.
- Display read-only computed defaults panel showing resolved values for clarity.

### Config / API Keys
- Table view listing `name`, masked `key`, `created_at`, `updated_at`, `blockingResponse.status`. Row actions: edit, delete.
- Create/Edit modal form with fields: `name`, `key` (toggle reveal), `blockingResponse.status/contentType/body` with live preview of blocking JSON default; auto-fill defaults per SPEC (200 JSON body) when empty.
- Backend integration: GET `/config/api/keys`, POST create, PATCH update by `id`, DELETE by `id`; optimistic UI with query invalidation.
- Validation: `status` 100–999, content-type non-empty when body supplied; enforce name uniqueness on client before submit (against cached list).

### Config / Pattern Rules
- Table with filters: context (request/response/response_stream), API key, text search by name/notes.
- Columns: `name`, `context`, `apiKeyName`, `paths` (badge list), matcher summary, updated_at.
- Create/Edit drawer with sections: metadata (name, notes), context selector (controls required fields), API key selector (dropdown from cached keys), paths editor (chips unless response_stream), matcher builder (equals/contains/exists with field + value), optional notes.
- Validation mirrors SPEC: paths required unless response_stream; matchers required unless response_stream; at least one matcher field set; name unique within context; apiKeyName must exist; context enum accepts response-stream alias.
- CRUD via `/config/api/patterns` (GET list, POST create, PATCH update by id, DELETE by id) with query invalidation and toasts.

### System
- Tabbed layout: **System** (default) and **Collector** tabs.
- System tab: MITM cert download tiles (PEM `/config/mitm/ca.pem`, CER `/config/mitm/ca.cer` with copyable curl), config export (`/config/api/store` GET) with download metadata, config import dropzone + preview + PUT `/config/api/store` apply with confirmation.
- Collector tab: display `total/remaining` from `/collector/api`; actions to clear and set remaining (POST). Show recent capture hint linking to pipeline docs. Respect 50-entry cap in UI copy.

## Data Layer & API Strategy
- Central `httpClient` built on fetch with base URL derived from window origin + `/config`; handles JSON parsing, error mapping, and `cache-control: no-store` headers gracefully.
- Query keys per resource: `hosts`, `hostConfig(host)`, `apiKeys`, `patterns`, `store`, `collector`.
- Mutations invalidate relevant queries; use `toast` for success/error; error handler surfaces server message when available.
- DTO ↔ form mapping functions isolate UI forms from raw API shapes (e.g., blockingResponse defaults, matcher normalization, context alias handling).

## State, Forms, and Validation
- `react-hook-form` + `zodResolver` per feature form; default values populated from fetched data.
- Dirty-state tracking for Save/Reset buttons; disable submit while pending; inline field errors.
- Derived/inherited fields displayed separately to reduce accidental overrides (computed view for host defaults).

## Theming & Tailwind Setup
- Extend Tailwind theme with CSS variables for light-default tokens: `--bg:#F5F5F4`, `--card:#FFFFFF`, `--border:#E5E7EB`, `--accent:#E31735` (F5), `--accent-foreground:#FFFFFF`, `--muted:#F3F4F6`, `--warning:#F59E0B`, `--success:#0EA5E9`, `--text:#0F172A`. Add dark equivalents for future toggle.
- Configure shadcn to use custom radius (12px), font stack, and accent color = F5 crimson; generate components once and commit them.
- Light theme shipped as default; dark theme tokens prepared behind a `data-theme` toggle for later activation.

## Build & Integration Steps
- Add `ui/` workspace with Vite config for base `/config/ui/` (ensures assets resolve when served from management port).
- Update Node static route (`node/src/routes/static.js`) to serve built assets from `html/` (or `html/dist`) with SPA fallback for `/config/ui*` to `index.html`; adjust cache-control to `no-store` as today.
- Replace legacy `html/` contents with built assets during build; ensure MITM download endpoints remain unchanged.
- Root-level scripts: `npm run dev:ui` (ui dev server), `npm run build:ui`, `npm run preview:ui`, `npm run lint:ui`, `npm run test:ui` for CI/local.

## Testing & QA
- Unit/component tests for:
  - Host config form validation (enum enforcement, numeric bounds, URL validation).
  - API keys form: status bounds, default blocking response, masking toggle.
  - Pattern rule form: context-specific required fields.
  - System import flow: rejects invalid JSON and shows confirmation.
- Integration smoke: start backend (`npm run dev`), run `npm run dev` in `ui`, manual verification of routes; later add Playwright smoke for navigation if time allows.

## Migration & Work Breakdown
1) Scaffold `ui/` workspace (Vite TS React, Tailwind, shadcn config, fonts, eslint/prettier).
2) Define light-first theme tokens (F5 palette), global styles, AppShell, sidebar navigation, routing skeleton with placeholder pages.
3) Implement data layer (http client, query client provider, DTO types) and System export/import + cert download (quick win to validate API wiring).
4) Build Config pages incrementally:
   - Host Config (host picker, create/delete, form with defaults + diffed patch).
   - API Keys (list + modal CRUD).
   - Pattern Rules (list + filters + form builder).
5) Implement Monitor/Logs placeholder with future-ready hooks and empty state.
6) Wire toasts, error boundaries, loading skeletons across pages; add responsive/collapsible sidebar.
7) Update `node/src/routes/static.js` and root scripts; remove old `html/css|js|scanner-config.html` artifacts after confirming new build works.
8) Add component tests; document smoke steps in `tests/README.md` if changed.
9) Final polish pass (states, focus rings, accessibility labels), then produce build and verify served via management port.

## Status
- Done (Dec 8, 2025):
  - Scaffolded `ui/` Vite/React/TS/Tailwind/shadcn workspace with F5 light theme tokens and fonts.
  - Added AppShell with sidebar/top bar navigation for Monitor, Config, System/Collector; mobile drawer included.
  - Added branded favicon/logomark, global styles, and placeholder pages for Logs, Host Config, API Keys, Pattern Rules, System, Collector aligned to NEW_UI_PLAN sections.
- Next:
  1) Wire data layer (React Query hooks + DTO/types/zod) to `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api` and implement forms/tables.
  2) Connect System export/import + cert download to live endpoints and add confirmation/dropzone flows.
  3) Update `node/src/routes/static.js` + root scripts to serve `ui/dist` with SPA fallback; replace legacy `html/` assets during build.
  4) Add Vitest + RTL coverage for form validation and shell rendering; document smoke steps in `tests/README.md`.
