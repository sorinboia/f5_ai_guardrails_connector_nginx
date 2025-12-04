# Node-based image for the Guardrails connector (NGINX retired)
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/node

# Base runtime deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
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
RUN mkdir -p /var/log/connector

EXPOSE 22080 22443 22100 10000

CMD ["bash", "-lc", "umask 022; exec node src/server.js"]
