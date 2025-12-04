# Node-based image for the Guardrails connector (NGINX retired)
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/node

# mitmproxy for optional MITM sidecar and cert generation
RUN apt-get update \
  && apt-get install -y --no-install-recommends mitmproxy ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY node/package*.json ./
RUN npm ci --omit=dev

# Copy application source and runtime assets
COPY node/src ./src
COPY node/var ./var
COPY html /etc/nginx/html
COPY certs /etc/nginx/certs
COPY mitmproxy.py /app/mitmproxy.py

# Ensure runtime directories exist
RUN mkdir -p /var/lib/mitmproxy /var/log/connector

EXPOSE 11434 11443 10000

CMD ["bash", "-lc", "umask 022; mkdir -p /var/lib/mitmproxy; mitmdump --set confdir=/var/lib/mitmproxy --mode regular --listen-host 0.0.0.0 --listen-port 10000 -s /app/mitmproxy.py --ssl-insecure & exec node src/server.js"]
