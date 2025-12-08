# syntax=docker/dockerfile:1

# Optional UI build. When SKIP_UI_BUILD=true, we reuse the prebuilt
# assets under html/. Default is to build the UI inside the image.
FROM node:22-bookworm AS ui-build
ARG SKIP_UI_BUILD=false
WORKDIR /app

COPY html ./html
COPY ui/package.json ui/package-lock.json ./ui/

RUN if [ "$SKIP_UI_BUILD" != "true" ]; then cd ui && npm ci; fi
COPY ui ./ui
RUN if [ "$SKIP_UI_BUILD" != "true" ]; then cd ui && npm run build; else mkdir -p /app/ui/dist && cp -r /app/html/. /app/ui/dist; fi

FROM node:22-bookworm AS node-deps
WORKDIR /app/node
COPY node/package.json node/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/node
ENV NODE_ENV=production

# App runtime dependencies
COPY --from=node-deps /app/node/node_modules ./node_modules

# Application code and assets
COPY node/src ./src
COPY node/package.json node/package-lock.json ./
COPY node/var ./var
COPY certs /app/certs
COPY --from=ui-build /app/ui/dist /app/html

EXPOSE 22080 22443 22100 10000

CMD ["node", "src/server.js"]
