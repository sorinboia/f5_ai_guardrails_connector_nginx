# F5 AI Guardrails Connector

Fastify-based reverse proxy that applies Calypso Guardrails scanning to AI traffic. It inspects requests, responses, and streaming chunks before forwarding to your configured upstream. A management UI/API lets you edit allowlists, patterns, and keys, while an in-process forward proxy enforces host allowlists and still routes through the same inspection pipeline.

## What it does
- Listens on data-plane HTTP `22080` and optional HTTPS `22443` when cert/key are present.
- Serves management UI/APIs on `22100` (`/config/ui`, `/config/api*`, `/collector/api`).
- Runs the Guardrails inspection pipeline against all proxied traffic (bypass only for `/api/tags`).
- Forward proxy on `10000` enforces destinations stored in the config file and relays into the data-plane listeners so inspection always applies.

## Run with Docker
```bash
# build the image from this repo
docker build -t sorinboiaf5/f5-ai-connector:latest .

# run with required ports and your Guardrails token
docker run --rm \
  -p 22080:22080 -p 22443:22443 -p 22100:22100 -p 10000:10000 \
  -e SIDEBAND_BEARER=your_token_here \
  sorinboiaf5/f5-ai-connector:latest
```
Common options to add:
- Mount config store for persistence: `-v $(pwd)/var:/app/var`
- Bring your own cert/key: `-v $(pwd)/certs:/app/certs -e HTTPS_CERT=certs/server.crt -e HTTPS_KEY=certs/server.key`
- Disable forward proxy: `-e FORWARD_PROXY_ENABLED=false`

## Environment variables
Defaults come from `node/src/config/env.js` and are restated in `SPEC_BACKEND.md`.
- `BACKEND_ORIGIN` (default `https://api.openai.com`): upstream to forward inspected traffic.
- `SIDEBAND_URL` (default `https://www.us1.calypsoai.app/backend/v1/scans`): Guardrails scan endpoint.
- `SIDEBAND_BEARER` (no default): bearer token for Guardrails API.
- `SIDEBAND_UA` (default `njs-sideband/1.0`), `SIDEBAND_TIMEOUT_MS` (default `5000`).
- `HTTP_PORT` `22080`, `HTTPS_PORT` `22443`, `MANAGEMENT_PORT` `22100`.
- `HTTPS_CERT`/`HTTPS_KEY` (defaults `certs/sideband-local.crt` and `.key`), HTTPS turns on only when both files exist.
- `DYNAMIC_CERTS_ENABLED` (`false`), `MITM_CA_CERT`, `MITM_CA_KEY`, `MITM_CERT_VALIDITY_DAYS` (`365`): enable per-host MITM cert issuance.
- `FORWARD_PROXY_ENABLED` (`true`), `FORWARD_PROXY_PORT` (`10000`).
- `CONFIG_STORE_PATH` (`var/guardrails_config.json`): persisted hosts/keys/patterns/collector config.
- `CA_BUNDLE` (`/etc/ssl/certs/ca-certificates.crt`): trust bundle for upstream TLS.
- `LOG_LEVEL` (`info`).

## Local development
```bash
cd node
npm install
npm run dev    # HTTP on 22080; HTTPS on 22443 when certs exist in ./certs
```
Management UI is served from the same process at `http://localhost:22100/config/ui`.

## Smoke test curl
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
Watch container logs for inspection outcomes; switch to `https://localhost:22443` when you supply TLS assets. The management UI/API stay on `http://localhost:22100`.
