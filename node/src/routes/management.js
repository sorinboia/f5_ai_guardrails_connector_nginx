import fp from 'fastify-plugin';
import { configApi, apiKeysApi, patternsApi, storeApi, collectorApi } from './api/index.js';

async function managementRoutes(fastify) {
  await configApi(fastify);
  await apiKeysApi(fastify);
  await patternsApi(fastify);
  await storeApi(fastify);
  await collectorApi(fastify);
}

export default fp(managementRoutes);
