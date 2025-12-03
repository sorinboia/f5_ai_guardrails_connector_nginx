import fp from 'fastify-plugin';
import proxy from '@fastify/http-proxy';
import managementRoutes from './management.js';
import staticRoutes from './static.js';
import proxyRoutes from './proxy.js';

// Registers baseline routes: /api/tags passthrough and catch-all stub.
async function routes(fastify, opts) {
  const backendOrigin = opts.backendOrigin;

  // Static UI + MITM downloads.
  fastify.register(staticRoutes);

  // /api/tags direct passthrough (no inspection/redaction yet).
  fastify.register(proxy, {
    upstream: backendOrigin,
    prefix: '/api/tags',
    rewritePrefix: '/api/tags',
    http2: false,
  });

  // Management APIs (placeholders for now).
  fastify.register(managementRoutes);

  // Catch-all proxy (pipeline hooks to be added later).
  fastify.register(proxyRoutes, { backendOrigin });
}

export default fp(routes);
