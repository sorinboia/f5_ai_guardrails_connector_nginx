import fp from 'fastify-plugin';
import proxy from '@fastify/http-proxy';
import { buildProxyHandler } from '../pipeline/proxyPipeline.js';
import { getHeaderHost } from './helpers.js';
import { resolveConfig } from '../config/validate.js';
import { defaultStore } from '../config/store.js';

function resolveBackendContext(fastify, request) {
  const store = fastify.store || defaultStore();
  const host = getHeaderHost(request);
  const config = resolveConfig(store, host);
  const backendOrigin = config.backendOrigin || fastify.appConfig.backendOrigin;
  let upstreamHost = '';
  try {
    upstreamHost = new URL(backendOrigin).host;
  } catch (_) {
    upstreamHost = new URL(fastify.appConfig.backendOrigin).host;
  }
  return { backendOrigin, upstreamHost };
}

async function proxyRoutes(fastify, opts) {
  const { backendOrigin } = opts;

  // /api/tags passthrough without inspection.
  fastify.register(proxy, {
    // Upstream is resolved per-request so host-specific backendOrigin is honored.
    upstream: '',
    prefix: '/api/tags',
    rewritePrefix: '/api/tags',
    http2: false,
    replyOptions: {
      getUpstream(request) {
        const ctx = resolveBackendContext(fastify, request);
        return ctx.backendOrigin;
      },
      rewriteRequestHeaders(request, headers) {
        const ctx = resolveBackendContext(fastify, request);
        const next = { ...headers, host: ctx.upstreamHost };
        delete next.connection;
        delete next['proxy-connection'];
        return next;
      }
    }
  });

  // Catch-all Node pipeline.
  fastify.all('/*', buildProxyHandler(fastify));
}

export default fp(proxyRoutes);
