import fp from 'fastify-plugin';
import proxy from '@fastify/http-proxy';
import managementRoutes from './management.js';
import staticRoutes from './static.js';
import proxyRoutes from './proxy.js';
import { resolveConfig } from '../config/validate.js';
import { defaultStore } from '../config/store.js';
import { getHeaderHost } from './helpers.js';

function normalizeLogLevel(level, fallback) {
  if (!level) return fallback;
  const map = { err: 'error' };
  const val = String(level).toLowerCase();
  const normalized = map[val] || val;
  const allowed = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  return allowed.includes(normalized) ? normalized : fallback;
}

// Registers static assets, management APIs, and the proxy pipeline.
async function routes(fastify, opts) {
  const backendOrigin = opts.backendOrigin || fastify?.appConfig?.backendOrigin;
  const enableStatic = opts.enableStatic ?? true;
  const enableManagement = opts.enableManagement ?? true;
  const enableProxy = opts.enableProxy ?? true;

  // Per-request logger level based on resolved host config or header override.
  fastify.addHook('onRequest', (request, reply, done) => {
    const store = fastify.store || defaultStore();
    const host = getHeaderHost(request);
    const config = resolveConfig(store, host);

    const withHost = request.log.child({ host });
    request.log = withHost;
    reply.log = withHost;

    const headerLevel = request.headers['x-sideband-log'];
    const targetLevel = normalizeLogLevel(headerLevel || config.logLevel, fastify.appConfig.logLevel);
    if (targetLevel && request.log.level !== targetLevel) {
      const child = request.log.child({ host_log_level: targetLevel }, { level: targetLevel });
      request.log = child;
      reply.log = child;
    }
    done();
  });

  // Static UI + MITM downloads.
  if (enableStatic) {
    fastify.register(staticRoutes);
  }

  // Management APIs (placeholders for now).
  if (enableManagement) {
    fastify.register(managementRoutes);
  }

  // Proxy pipeline (includes /api/tags passthrough and catch-all).
  if (enableProxy) {
    fastify.register(proxyRoutes, { backendOrigin });
  }
}

export default fp(routes);
