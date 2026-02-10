// Store API endpoints (import/export)
import { normalizeHostName } from '../../config/hosts.js';
import { resolveConfig } from '../../config/validate.js';
import { respondJson, optionsReply, getHeaderHost } from '../helpers.js';
import { defaultStore, saveStore, validateStoreShape } from '../../config/store.js';
import { getBody } from '../../utils/helpers.js';
import { CONFIG_ENUMS } from '../../config/constants.js';

function replaceStore(target, nextStore) {
  const keys = new Set(Object.keys(target));
  Object.entries(nextStore).forEach(([key, value]) => {
    target[key] = value;
    keys.delete(key);
  });
  keys.forEach((key) => {
    delete target[key];
  });
}

export async function storeApi(fastify) {
  fastify.options('/config/api/store', async (_, reply) => optionsReply(reply, 'GET, PUT, OPTIONS', 'content-type'));

  fastify.get('/config/api/store', async (request, reply) => {
    const store = fastify.store || defaultStore();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `guardrails-config-${timestamp}.json`;
    reply
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store');
    return respondJson(reply, 200, store, 'GET, PUT, OPTIONS');
  });

  fastify.put('/config/api/store', async (request, reply) => {
    const payload = getBody(request);
    const { ok, store: nextStore, errors } = validateStoreShape(payload);
    if (!ok) return respondJson(reply, 400, { error: 'validation_failed', errors });

    const store = fastify.store || defaultStore();
    replaceStore(store, nextStore);
    saveStore(store, fastify.log, fastify.appConfig.storePath);

    const requestedHost = normalizeHostName(getHeaderHost(request));
    const activeHost = store.hosts.includes(requestedHost) ? requestedHost : '__default__';
    const config = resolveConfig(store, activeHost);

    return respondJson(reply, 200, {
      store,
      host: activeHost,
      hosts: store.hosts,
      config,
      defaults: resolveConfig(store, '__default__'),
      options: CONFIG_ENUMS
    });
  });
}
