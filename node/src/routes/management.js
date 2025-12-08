import fp from 'fastify-plugin';
import { normalizeHostName, resolveConfig, validateConfigPatch } from '../config/validate.js';
import { respondJson, optionsReply, getHeaderHost, ensureHeaderMatchesHost } from './helpers.js';
import { defaultStore, saveStore, validateStoreShape } from '../config/store.js';
import { scheduleCollection, clearCollection } from '../pipeline/collector.js';

function ensureHost(store, host) {
  const target = normalizeHostName(host);
  if (!store.hosts.includes(target)) store.hosts.push(target);
  if (!store.hostConfigs[target]) store.hostConfigs[target] = {};
  return target;
}

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

const CONFIG_OPTIONS = {
  inspectMode: ['off', 'request', 'response', 'both'],
  redactMode: ['off', 'request', 'response', 'both'],
  logLevel: ['debug', 'info', 'warn', 'err'],
  requestForwardMode: ['sequential', 'parallel'],
  responseStreamBufferingMode: ['buffer', 'passthrough']
};

function removeHost(store, host) {
  const target = normalizeHostName(host);
  store.hosts = store.hosts.filter((h) => h !== target);
  delete store.hostConfigs[target];
}

export function sanitizeBlockingResponse(value) {
  const defaults = {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ message: { role: 'assistant', content: 'F5 AI Guardrails blocked this request' } })
  };
  if (!value || typeof value !== 'object') return defaults;
  const sanitized = { ...defaults };
  if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 999) sanitized.status = value.status;
  if (typeof value.contentType === 'string' && value.contentType.trim()) sanitized.contentType = value.contentType;
  if (typeof value.body === 'string') sanitized.body = value.body;
  return sanitized;
}

function uniqueId(prefix) {
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}_${Date.now()}_${rand}`;
}

function getBody(request) {
  if (!request.body) return {};
  if (typeof request.body === 'object') return request.body;
  try {
    return JSON.parse(request.body);
  } catch (err) {
    return {};
  }
}

function getConfigTargetHost(request, payload) {
  const bodyHost = payload?.host;
  return normalizeHostName(bodyHost || getHeaderHost(request));
}

async function configApi(fastify) {
  fastify.options('/config/api', async (_, reply) => optionsReply(reply, 'GET, PATCH, POST, DELETE, OPTIONS', 'content-type, x-guardrails-config-host'));

  fastify.get('/config/api', async (request, reply) => {
    const store = fastify.store || defaultStore();
    const host = getHeaderHost(request);
    ensureHost(store, host);
    const config = resolveConfig(store, host);
    return respondJson(reply, 200, {
      config,
      host,
      hosts: store.hosts,
      options: CONFIG_OPTIONS,
      defaults: resolveConfig(store, '__default__')
    });
  });

  fastify.patch('/config/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const targetHost = getConfigTargetHost(request, payload);
    const headerCheck = ensureHeaderMatchesHost(request, targetHost);
    if (!headerCheck.ok) return respondJson(reply, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to update.' });

    const { errors, updates } = validateConfigPatch(payload || {});
    if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });

    ensureHost(store, targetHost);
    const next = { ...store.hostConfigs[targetHost] };

    // Aliases
    if (updates.requestExtractor !== undefined && updates.requestExtractors === undefined) updates.requestExtractors = updates.requestExtractor ? [updates.requestExtractor] : [];
    if (updates.responseExtractor !== undefined && updates.responseExtractors === undefined) updates.responseExtractors = updates.responseExtractor ? [updates.responseExtractor] : [];

    Object.assign(next, updates);
    store.hostConfigs[targetHost] = next;
    saveStore(store, fastify.log, fastify.appConfig.storePath);

    const config = resolveConfig(store, targetHost);
    return respondJson(reply, 200, {
      config,
      applied: updates,
      host: targetHost,
      hosts: store.hosts,
      options: CONFIG_OPTIONS,
      defaults: resolveConfig(store, '__default__')
    });
  });

  fastify.post('/config/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const hostValue = payload?.host;
    if (!hostValue || typeof hostValue !== 'string') return respondJson(reply, 400, { error: 'missing_host', message: 'Provide a host field to create a configuration entry.' });
    const targetHost = normalizeHostName(hostValue);
    const headerCheck = ensureHeaderMatchesHost(request, targetHost);
    if (!headerCheck.ok && targetHost !== '__default__') return respondJson(reply, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to create.' });
    if (store.hosts.includes(targetHost)) return respondJson(reply, 409, { error: 'host_exists', message: 'Host already has a configuration entry.' });

    ensureHost(store, targetHost);

    if (payload.config) {
      const { errors, updates } = validateConfigPatch(payload.config);
      if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });
      const next = { ...store.hostConfigs[targetHost], ...updates };
      store.hostConfigs[targetHost] = next;
    }

    saveStore(store, fastify.log, fastify.appConfig.storePath);
    const config = resolveConfig(store, targetHost);
    return respondJson(reply, 201, {
      config,
      applied: payload.config || {},
      host: targetHost,
      hosts: store.hosts,
      options: CONFIG_OPTIONS,
      defaults: resolveConfig(store, '__default__')
    });
  });

  fastify.delete('/config/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const targetHost = normalizeHostName(payload.host || getHeaderHost(request));
    if (targetHost === '__default__') return respondJson(reply, 400, { error: 'cannot_delete_default', message: 'The default host cannot be removed.' });
    const headerCheck = ensureHeaderMatchesHost(request, targetHost);
    if (!headerCheck.ok) return respondJson(reply, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to delete.' });
    if (!store.hosts.includes(targetHost)) return respondJson(reply, 404, { error: 'host_not_found', message: 'Host configuration not found.' });

    removeHost(store, targetHost);
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    const config = resolveConfig(store, '__default__');
    return respondJson(reply, 200, {
      removed: targetHost,
      host: '__default__',
      hosts: store.hosts,
      config,
      options: CONFIG_OPTIONS,
      defaults: config
    });
  });
}

function findApiKey(store, id) {
  return store.apiKeys.find((k) => k.id === id);
}

function findApiKeyByName(store, name) {
  return store.apiKeys.find((k) => k.name === name);
}

async function apiKeys(fastify) {
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

function validateMatcher(m) {
  if (!m || typeof m.path !== 'string' || !m.path.trim()) return false;
  if (m.equals === undefined && m.contains === undefined && m.exists === undefined) return false;
  return true;
}

function validatePatternPayload(payload, store) {
  const errors = [];
  const name = payload.name && payload.name.trim();
  if (!name) errors.push('name required');
  const context = (payload.context || '').toString().replace('-', '_');
  if (!['request', 'response', 'response_stream'].includes(context)) errors.push('invalid context');
  const apiKeyName = payload.apiKeyName && payload.apiKeyName.trim();
  if (!apiKeyName || !store.apiKeys.find((k) => k.name === apiKeyName)) errors.push('apiKeyName must reference existing API key');

  const paths = Array.isArray(payload.paths) ? payload.paths.map((p) => String(p)) : [];
  const matchers = Array.isArray(payload.matchers) ? payload.matchers : [];
  if (context !== 'response_stream') {
    if (!paths.length) errors.push('paths required');
    if (!matchers.length) errors.push('matchers required');
    if (matchers.some((m) => !validateMatcher(m))) errors.push('invalid matcher');
  }

  return { errors, context, apiKeyName, name, paths, matchers };
}

async function patternsApi(fastify) {
  fastify.options('/config/api/patterns', async (_, reply) => optionsReply(reply, 'GET, POST, PATCH, DELETE, OPTIONS', 'content-type'));

  fastify.get('/config/api/patterns', async (request, reply) => {
    const store = fastify.store || defaultStore();
    return respondJson(reply, 200, { items: store.patterns });
  });

  fastify.post('/config/api/patterns', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const { errors, context, apiKeyName, name, paths, matchers } = validatePatternPayload(payload, store);
    if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });
    if (store.patterns.find((p) => p.name === name && p.context === context)) return respondJson(reply, 409, { error: 'name_exists' });

    const record = {
      id: uniqueId('pat'),
      name,
      context,
      apiKeyName,
      paths: context === 'response_stream' ? [] : paths,
      matchers: context === 'response_stream' ? [] : matchers,
      notes: payload.notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    store.patterns.push(record);
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 201, { item: record });
  });

  fastify.patch('/config/api/patterns', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    if (!payload.id) return respondJson(reply, 400, { error: 'missing_id' });
    const existing = store.patterns.find((p) => p.id === payload.id);
    if (!existing) return respondJson(reply, 404, { error: 'not_found' });

    const next = { ...existing, ...payload };
    const { errors, context, apiKeyName, name, paths, matchers } = validatePatternPayload(next, store);
    if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });
    if (store.patterns.find((p) => p.id !== existing.id && p.name === name && p.context === context)) return respondJson(reply, 409, { error: 'name_exists' });

    existing.name = name;
    existing.context = context;
    existing.apiKeyName = apiKeyName;
    existing.paths = context === 'response_stream' ? [] : paths;
    existing.matchers = context === 'response_stream' ? [] : matchers;
    existing.notes = next.notes || '';
    existing.updated_at = new Date().toISOString();
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 200, { item: existing });
  });

  fastify.delete('/config/api/patterns', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    if (!payload.id) return respondJson(reply, 400, { error: 'missing_id' });
    const before = store.patterns.length;
    store.patterns = store.patterns.filter((p) => p.id !== payload.id);
    if (store.patterns.length === before) return respondJson(reply, 404, { error: 'not_found' });
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    return respondJson(reply, 200, { removed: payload.id });
  });
}

async function storeApi(fastify) {
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
      options: CONFIG_OPTIONS
    });
  });
}

async function collectorApi(fastify) {
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

async function managementRoutes(fastify) {
  await configApi(fastify);
  await apiKeys(fastify);
  await patternsApi(fastify);
  await storeApi(fastify);
  await collectorApi(fastify);
}

export default fp(managementRoutes);
