import fp from 'fastify-plugin';
import proxy from '@fastify/http-proxy';
import managementRoutes from './management.js';
import staticRoutes from './static.js';
import proxyRoutes from './proxy.js';

// Registers static assets, management APIs, and the proxy pipeline.
async function routes(fastify, opts) {
  const backendOrigin = opts.backendOrigin;

  // Static UI + MITM downloads.
  fastify.register(staticRoutes);

  // Management APIs (placeholders for now).
  fastify.register(managementRoutes);

  // Proxy pipeline (includes /api/tags passthrough and catch-all).
  fastify.register(proxyRoutes, { backendOrigin });
}

export default fp(routes);
