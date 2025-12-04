# Migration Plan: NGINX+njs ➜ Node.js

This plan tracked the replacement of the NGINX + njs reverse‑proxy connector with the Fastify/Node service in `node/`. NGINX configs and njs scripts have now been removed; the repository and Docker image are Node-only. The behaviour remains defined in `SPEC.md`.

## Current Status (Dec 4, 2025)
- ✅ Phases 1–6 completed (parity mapping, architecture spike, core pipeline, management APIs, static assets, unit coverage).
- ✅ Phase 7 completed: Dockerfile now builds a Node-only image; forward proxy is handled in-process by Node instead of a mitmproxy sidecar. NGINX artifacts removed from the repo and runtime.
- ✅ Phase 8 completed: primary stack is Node; rollback path is prior git history containing `conf.d/`, `njs/`, and `nginx.conf`.
- 🟡 Phase 9 (docs/tests polish) mostly done: `SPEC.md`, `README.md`, `tests/README.md` updated. Remaining items listed below.

## What Changed in This Cutover
- Removed all NGINX-specific files (`conf.d/guardrails_connector.conf`, `njs/*`, `nginx.conf`, default fastcgi/mime includes, module symlink).
- Replaced Dockerfile with a Node-base image that starts `mitmdump` and `node src/server.js`; keeps UI assets under `/etc/nginx/html` and certs under `/etc/nginx/certs` for compatibility.
- Updated `SPEC.md` to make the Node service the canonical implementation and refreshed endpoints/pipeline details accordingly.
- Updated `README.md` and `tests/README.md` to remove NGINX commands and point to Node workflows.

## Remaining Follow-ups
1) **Integration/parity tests**: Port any outstanding bash integration cases to hit the Node server directly (some smoke coverage already in `tests/smoke/node-shadow.sh`).
2) **Performance & resiliency**: Capture latency/throughput versus the former NGINX stack; validate fail-open/closed toggles, TLS reload paths, and the new Node forward-proxy flow.
3) **Packaging & release**: Publish the new Node image tag and document upgrade/rollback steps for operators; update any downstream manifests or deployment templates.
4) **Observability**: Confirm log field parity against historical telemetry and add dashboards/alerts if needed.

## Cutover Notes
- Ports now default to management/UI on 22100, data plane HTTP 22080, data plane HTTPS 22443; forward proxy listener (Node) on 10000.
- Rollback requires checking out a git revision prior to this cutover to restore NGINX configs/scripts.
- Static assets and cert locations remain unchanged so the UI continues to work.

## Checklist
- [x] Node parity features implemented (request/response/stream inspection, redaction, collector, management APIs, static UI, forward proxy).
- [x] Dockerfile uses Node runtime; no NGINX dependency.
- [x] Specs/docs updated to reflect Node ownership.
- [ ] Integration/perf validation captured and published.
- [ ] Release artefacts promoted to production registries.
