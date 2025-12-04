# F5 AI Guardrails Node Connector

This repository now runs a Fastify-based reverse proxy (Node.js) that replaces the previous NGINX+njs stack. It preserves the same behaviour documented in `SPEC.md`: request/response/stream inspection, optional redaction, collector quotas, management APIs, static UI, and MITM certificate downloads. All NGINX configs and njs scripts have been removed.

## What it does
- Proxies AI traffic on HTTP `:11434` (and HTTPS `:11443` when certs are present).
- Inspects requests, responses, and streaming chunks via the Guardrails Scan API; blocks or redacts as instructed.
- Exposes management APIs and the UI at `/config/*` and `/collector/*`.
- Serves MITM CA downloads from `/config/mitm/` (files written by the bundled `mitmdump` sidecar).

## Run locally
```bash
cd /etc/nginx/node
npm install
npm run dev        # HTTP 11434; HTTPS 443 if certs in /etc/nginx/certs
```
Environment toggles (mirrors SPEC defaults):
- `BACKEND_ORIGIN` (default `https://api.openai.com`)
- `SIDEBAND_URL` (default `https://www.us1.calypsoai.app/backend/v1/scans`)
- `SIDEBAND_BEARER`, `SIDEBAND_UA`, `SIDEBAND_TIMEOUT_MS`
- `CA_BUNDLE` (default `/etc/ssl/certs/ca-certificates.crt`)
- `HTTP_PORT`, `HTTPS_PORT`, `HTTPS_CERT`, `HTTPS_KEY`
- `CONFIG_STORE_PATH` (default `var/guardrails_config.json`)

## Docker image (Node-only)
```
docker build -t sorinboiaf5/f5-ai-connector:latest .
docker run --rm -p 11434:11434 -p 11443:11443 -p 10000:10000 \
  -e BACKEND_ORIGIN=https://api.openai.com \
  -e SIDEBAND_URL=https://www.us1.calypsoai.app/backend/v1/scans \
  -e SIDEBAND_BEARER=your_token_here \
  sorinboiaf5/f5-ai-connector:latest
```
- MITM optional: add `-e MITM_TARGETS="chatgpt.com=127.0.0.1:443"` (comma-separated list) to retarget domains; certs are written to `/var/lib/mitmproxy` and downloadable from `/config/mitm/mitmproxy-ca-cert.(pem|cer)`.
- The container starts `mitmdump` and the Node server side by side; remove the port mapping if you don’t need MITM (`-p 10000:10000`).

## Key endpoints
- Proxy: any path except `/config/*` and `/collector/*` → full inspection pipeline.
- Bypass: `/api/tags` proxies upstream without inspection.
- Management APIs: `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api`.
- UI: `/config/ui`, `/config/ui/keys`, `/config/ui/patterns`; redirects remain (`/collector/ui`).
- MITM CA: `/config/mitm/mitmproxy-ca-cert.pem|.cer`.

## Testing
- Unit + helpers: `cd node && npm test` (Vitest).
- Smoke (Node shadow): `tests/smoke/node-shadow.sh` spins up stub servers and exercises pass/block/redact/stream flows on alt ports.

## File tour
- `node/src/server.js` — Fastify bootstrap + HTTPS optional listener.
- `node/src/pipeline/*` — inspection, redaction, streaming, collector, Guardrails client.
- `node/src/config/*` — env loading, store persistence (`var/guardrails_config.json`), validation.
- `node/src/routes/*` — management routes, static asset routes, proxy pipeline.
- `html/` — UI bundle served by Fastify static routes.
- `certs/` — local TLS materials for optional HTTPS listener.
- `mitmproxy.py` — mitmdump addon for optional MITM sidecar.

## Smoke curl example
```bash
curl http://localhost:11434/api/chat -H "content-type: application/json" -d '{
  "model": "llama3.1:8b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Write me a haiku about open-source AI." }
  ],
  "stream": false
}'
```
Inspect Node logs (stdout) to confirm inspection decisions. If HTTPS is enabled, use `https://localhost:11443` with the matching cert.
