// Collector API endpoints
import { respondJson, optionsReply } from '../helpers.js';
import { defaultStore, saveStore } from '../../config/store.js';
import { scheduleCollection, clearCollection } from '../../pipeline/collector.js';
import { getBody } from '../../utils/helpers.js';

export async function collectorApi(fastify) {
  fastify.options('/collector/api', async (_, reply) => optionsReply(reply, 'GET, POST, OPTIONS', 'content-type'));

  fastify.get('/collector/api', async (request, reply) => {
    const store = fastify.store || defaultStore();
    return respondJson(reply, 200, {
      total: store.collector.total,
      remaining: store.collector.remaining,
      entries: store.collector.entries
    });
  });

  fastify.post('/collector/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    if (payload.action === 'clear') {
      const next = clearCollection(store);
      saveStore(store, fastify.log, fastify.appConfig.storePath);
      return respondJson(reply, 200, next);
    }
    const count = Number(payload.count ?? payload.collect ?? payload.collect_count ?? 0);
    if (Number.isNaN(count) || count < 0) return respondJson(reply, 400, { error: 'invalid_count' });
    const next = scheduleCollection(store, count);
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 200, next);
  });
}
