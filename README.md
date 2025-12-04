# F5 AI Guardrails Node Connector

This repository now runs a Fastify-based reverse proxy (Node.js) that replaces the previous NGINX+njs stack. It preserves the same behaviour documented in `SPEC.md`: request/response/stream inspection, optional redaction, collector quotas, management APIs, static UI, and a Node-implemented forward proxy. All NGINX configs and njs scripts have been removed.

## What it does
- Proxies AI traffic on HTTP `:22080` (and HTTPS `:22443` when certs are present).
- Exposes the management UI/APIs separately on HTTP `:22100`.
- Inspects requests, responses, and streaming chunks via the Guardrails Scan API; blocks or redacts as instructed.
- Provides a forward proxy on `:10000` that only permits destinations present in the config store and forwards allowed traffic into the local data-plane listeners for inspection.

## Run locally
```bash
cd /etc/nginx/node
npm install
npm run dev        # HTTP 22080; HTTPS 22443 if certs in /etc/nginx/certs
```
Environment toggles (mirrors SPEC defaults):
- `BACKEND_ORIGIN` (default `https://api.openai.com`)
- `SIDEBAND_URL` (default `https://www.us1.calypsoai.app/backend/v1/scans`)
- `SIDEBAND_BEARER`, `SIDEBAND_UA`, `SIDEBAND_TIMEOUT_MS`
- `CA_BUNDLE` (default `/etc/ssl/certs/ca-certificates.crt`)
- `HTTP_PORT` (default `22080`), `HTTPS_PORT` (default `22443`), `MANAGEMENT_PORT` (default `22100`), `HTTPS_CERT`, `HTTPS_KEY`
- `FORWARD_PROXY_PORT` (default `10000`), `FORWARD_PROXY_ENABLED` (default `true`)
- `CONFIG_STORE_PATH` (default `var/guardrails_config.json`)

## Docker image (Node-only)
```
docker build -t sorinboiaf5/f5-ai-connector:latest .
docker run --rm -p 22080:22080 -p 22443:22443 -p 22100:22100 -p 10000:10000 \
  -e BACKEND_ORIGIN=https://api.openai.com \
  -e SIDEBAND_URL=https://www.us1.calypsoai.app/backend/v1/scans \
  -e SIDEBAND_BEARER=your_token_here \
  sorinboiaf5/f5-ai-connector:latest
```
- Forward proxy: define destinations in the config store (via management API/UI). Only listed hosts are allowed; traffic is relayed into the local HTTP/HTTPS listeners so inspection still applies.

## Key endpoints
- Proxy: any path except `/config/*` and `/collector/*` → full inspection pipeline.
- Bypass: `/api/tags` proxies upstream without inspection.
- Management APIs: `/config/api`, `/config/api/keys`, `/config/api/patterns`, `/collector/api`.
- UI: `/config/ui`, `/config/ui/keys`, `/config/ui/patterns`; redirects remain (`/collector/ui`).
- Forward proxy: HTTP absolute-form requests and `CONNECT` to port `10000` (dest must exist in config).

## Testing
- Unit + helpers: `cd node && npm test` (Vitest).
- Smoke (Node shadow): `tests/smoke/node-shadow.sh` spins up stub servers and exercises pass/block/redact/stream flows on alt ports.

## File tour
- `node/src/server.js` — Fastify bootstrap + HTTPS optional listener.
- `node/src/forwardProxy.js` — Node forward proxy that validates destinations and relays to local listeners.
- `node/src/pipeline/*` — inspection, redaction, streaming, collector, Guardrails client.
- `node/src/config/*` — env loading, store persistence (`var/guardrails_config.json`), validation.
- `node/src/routes/*` — management routes, static asset routes, proxy pipeline.
- `html/` — UI bundle served by Fastify static routes.
- `certs/` — local TLS materials for optional HTTPS listener.

## Smoke curl example
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
Inspect Node logs (stdout) to confirm inspection decisions. If HTTPS is enabled, use `https://localhost:22443` with the matching cert. Management UI/API live on `http://localhost:22100`.
