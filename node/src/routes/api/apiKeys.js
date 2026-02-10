// API Keys API endpoints
import { respondJson, optionsReply } from '../helpers.js';
import { defaultStore, saveStore } from '../../config/store.js';
import { getBody, uniqueId, sanitizeBlockingResponse } from '../../utils/helpers.js';

function findApiKey(store, id) {
  return store.apiKeys.find((k) => k.id === id);
}

function findApiKeyByName(store, name) {
  return store.apiKeys.find((k) => k.name === name);
}

export async function apiKeysApi(fastify) {
  fastify.options('/config/api/keys', async (_, reply) => optionsReply(reply, 'GET, POST, PATCH, DELETE, OPTIONS', 'content-type'));

  fastify.get('/config/api/keys', async (request, reply) => {
    const store = fastify.store || defaultStore();
    return respondJson(reply, 200, { items: store.apiKeys });
  });

  fastify.post('/config/api/keys', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const { name, key } = payload;
    if (!name || typeof name !== 'string' || !name.trim()) return respondJson(reply, 400, { error: 'missing_name', message: 'name is required' });
    if (!key || typeof key !== 'string' || !key.trim()) return respondJson(reply, 400, { error: 'missing_key', message: 'key is required' });
    if (findApiKeyByName(store, name.trim())) return respondJson(reply, 409, { error: 'name_exists', message: 'API key name must be unique.' });

    const record = {
      id: uniqueId('ak'),
      name: name.trim(),
      key: key,
      blockingResponse: sanitizeBlockingResponse(payload.blockingResponse),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    store.apiKeys.push(record);
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 201, { item: record });
  });

  fastify.patch('/config/api/keys', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    if (!payload.id) return respondJson(reply, 400, { error: 'missing_id', message: 'id is required' });
    const existing = findApiKey(store, payload.id);
    if (!existing) return respondJson(reply, 404, { error: 'not_found' });

    if (payload.name) {
      if (findApiKeyByName(store, payload.name) && payload.name !== existing.name) return respondJson(reply, 409, { error: 'name_exists' });
      existing.name = payload.name;
    }
    if (payload.key) existing.key = payload.key;
    if (payload.blockingResponse !== undefined) existing.blockingResponse = sanitizeBlockingResponse(payload.blockingResponse);
    existing.updated_at = new Date().toISOString();
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 200, { item: existing });
  });

  fastify.delete('/config/api/keys', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    if (!payload.id) return respondJson(reply, 400, { error: 'missing_id' });
    const before = store.apiKeys.length;
    store.apiKeys = store.apiKeys.filter((k) => k.id !== payload.id);
    if (store.apiKeys.length === before) return respondJson(reply, 404, { error: 'not_found' });
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 200, { removed: payload.id });
  });
}
