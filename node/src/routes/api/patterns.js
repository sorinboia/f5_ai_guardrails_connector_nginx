// Patterns API endpoints
import { respondJson, optionsReply } from '../helpers.js';
import { defaultStore, saveStore } from '../../config/store.js';
import { getBody, uniqueId } from '../../utils/helpers.js';

function validateMatcher(m) {
  if (!m || typeof m.path !== 'string' || !m.path.trim()) return false;
  if (m.equals === undefined && m.contains === undefined && m.exists === undefined) return false;
  return true;
}

function validateUrlRegex(urlRegex) {
  if (!urlRegex || typeof urlRegex !== 'string' || !urlRegex.trim()) return { valid: true, urlRegex: '' };
  try {
    new RegExp(urlRegex);
    return { valid: true, urlRegex: urlRegex.trim() };
  } catch (e) {
    return { valid: false, error: `invalid urlRegex: ${e.message}` };
  }
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
  const urlRegexResult = validateUrlRegex(payload.urlRegex);
  if (!urlRegexResult.valid) errors.push(urlRegexResult.error);
  const urlRegex = urlRegexResult.urlRegex || '';

  if (context !== 'response_stream') {
    // URL regex is required for pattern matching
    if (!urlRegex) errors.push('urlRegex is required');
    // Paths and matchers are optional but validated if present
    if (matchers.length && matchers.some((m) => !validateMatcher(m))) errors.push('invalid matcher');
  }

  return { errors, context, apiKeyName, name, paths, matchers, urlRegex };
}

export async function patternsApi(fastify) {
  fastify.options('/config/api/patterns', async (_, reply) => optionsReply(reply, 'GET, POST, PATCH, DELETE, OPTIONS', 'content-type'));

  fastify.get('/config/api/patterns', async (request, reply) => {
    const store = fastify.store || defaultStore();
    return respondJson(reply, 200, { items: store.patterns });
  });

  fastify.post('/config/api/patterns', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const { errors, context, apiKeyName, name, paths, matchers, urlRegex } = validatePatternPayload(payload, store);
    if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });
    if (store.patterns.find((p) => p.name === name && p.context === context)) return respondJson(reply, 409, { error: 'name_exists' });

    const record = {
      id: uniqueId('pat'),
      name,
      context,
      apiKeyName,
      paths: context === 'response_stream' ? [] : paths,
      matchers: context === 'response_stream' ? [] : matchers,
      urlRegex: context === 'response_stream' ? '' : urlRegex,
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
    const { errors, context, apiKeyName, name, paths, matchers, urlRegex } = validatePatternPayload(next, store);
    if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });
    if (store.patterns.find((p) => p.id !== existing.id && p.name === name && p.context === context)) return respondJson(reply, 409, { error: 'name_exists' });

    existing.name = name;
    existing.context = context;
    existing.apiKeyName = apiKeyName;
    existing.paths = context === 'response_stream' ? [] : paths;
    existing.matchers = context === 'response_stream' ? [] : matchers;
    existing.urlRegex = context === 'response_stream' ? '' : urlRegex;
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
