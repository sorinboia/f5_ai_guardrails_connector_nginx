export default { handle };

import { findApiKeyByName, readApiKeys, readPatterns, writePatterns, findPatternById } from './config_store.js';
import { makeLogger, safeJson } from './utils.js';

function respondJson(r, status, payload) {
  r.headersOut['content-type'] = 'application/json; charset=utf-8';
  r.headersOut['cache-control'] = 'no-store';
  r.return(status, JSON.stringify(payload));
}

async function readBody(r) {
  if (r.requestBuffer !== undefined) {
    return r.requestBuffer.toString('utf8');
  }
  if (r.requestText !== undefined) {
    return String(r.requestText);
  }
  return '';
}

function parseBody(text, log) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    log({ step: 'patterns:parse_error', error: String(err) }, 'warn');
    return undefined;
  }
}

function normalizeName(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeContext(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'request' || normalized === 'response') return normalized;
  if (normalized === 'response-stream' || normalized === 'response_stream') return 'response_stream';
  return '';
}

function normalizeNotes(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizePaths(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item === undefined || item === null) continue;
      const str = String(item).trim();
      if (str) out.push(str);
    }
    return out;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeMatchers(value) {
  const errors = [];
  const matchers = [];
  if (value === undefined || value === null) {
    return { matchers, errors: ['matchers must be a non-empty array'] };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { matchers, errors: ['matchers must be a non-empty array'] };
  }

  for (let i = 0; i < value.length; i++) {
    const raw = value[i] || {};
    const path = raw && raw.path !== undefined ? String(raw.path).trim() : '';
    const equals = raw && raw.equals !== undefined ? String(raw.equals).trim() : undefined;
    const contains = raw && raw.contains !== undefined ? String(raw.contains).trim() : undefined;
    const exists = raw && raw.exists !== undefined ? Boolean(raw.exists) : undefined;

    if (!path) {
      errors.push(`matchers[${i}].path must be provided.`);
      continue;
    }
    if (
      (equals === undefined || equals === '') &&
      (contains === undefined || contains === '') &&
      exists === undefined
    ) {
      errors.push(`matchers[${i}] must include at least one of equals, contains, or exists.`);
      continue;
    }

    matchers.push({
      path,
      equals: equals !== undefined && equals !== '' ? equals : undefined,
      contains: contains !== undefined && contains !== '' ? contains : undefined,
      exists: exists === true
    });
  }

  if (!matchers.length) {
    errors.push('matchers must include at least one valid rule.');
  }

  return { matchers, errors };
}

function generateId() {
  const seed = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e8).toString(36);
  return `pat_${seed}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function handleGet(r, log) {
  const items = readPatterns(r);
  log({ step: 'patterns:get', count: items.length }, 'debug');
  respondJson(r, 200, { items });
}

async function handlePost(r, log) {
  const text = await readBody(r);
  const payload = parseBody(text, log);
  if (payload === undefined) {
    respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return;
  }

  const name = normalizeName(payload.name);
  if (!name) {
    respondJson(r, 400, { error: 'missing_name', message: 'Provide a non-empty name.' });
    return;
  }

  const context = normalizeContext(payload.context);
  if (!context) {
    respondJson(r, 400, { error: 'invalid_context', message: 'Context must be "request", "response", or "response-stream".' });
    return;
  }

  const paths = normalizePaths(payload.paths);
  const { matchers, errors } = normalizeMatchers(payload.matchers);
  if (context === 'response_stream') {
    if ((payload.paths && paths.length) || (payload.matchers && matchers.length)) {
      respondJson(r, 400, { error: 'not_allowed', message: 'Extraction paths and matchers are not configurable for response-stream context.' });
      return;
    }
  } else {
    if (!paths.length) {
      respondJson(r, 400, { error: 'missing_paths', message: 'Provide at least one extraction path.' });
      return;
    }
    if (errors.length) {
      respondJson(r, 400, { error: 'invalid_matchers', details: errors });
      return;
    }
  }

  const apiKeyName = normalizeName(payload.apiKeyName);
  if (!apiKeyName) {
    respondJson(r, 400, { error: 'missing_api_key_name', message: 'Provide apiKeyName referencing a configured API key.' });
    return;
  }

  const apiKeys = readApiKeys(r);
  if (!findApiKeyByName(apiKeys, apiKeyName)) {
    respondJson(r, 400, { error: 'unknown_api_key', message: 'apiKeyName does not match a configured API key.' });
    return;
  }

  const notes = normalizeNotes(payload.notes);

  const items = readPatterns(r);
  for (let i = 0; i < items.length; i++) {
    if (items[i] && items[i].name === name && items[i].context === context) {
      respondJson(r, 409, { error: 'name_conflict', message: 'A pattern with this name already exists for the context.' });
      return;
    }
  }

  const record = {
    id: generateId(),
    name,
    context,
    apiKeyName,
    paths: context === 'response_stream' ? [] : paths,
    matchers: context === 'response_stream' ? [] : matchers,
    notes,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  items.push(record);
  const write = writePatterns(r, items, { log: 'err', r });
  if (!write.ok) {
    respondJson(r, 500, { error: 'store_failure', message: write.error || 'Unable to persist pattern.' });
    return;
  }

  log({ step: 'patterns:created', id: record.id, name, context }, 'info');
  respondJson(r, 201, { item: record });
}

async function handlePatch(r, log) {
  const text = await readBody(r);
  const payload = parseBody(text, log);
  if (payload === undefined) {
    respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return;
  }

  const id = payload && payload.id ? String(payload.id).trim() : '';
  if (!id) {
    respondJson(r, 400, { error: 'missing_id', message: 'Provide an id to update.' });
    return;
  }

  const items = readPatterns(r);
  const existing = findPatternById(items, id);
  if (!existing) {
    respondJson(r, 404, { error: 'not_found', message: 'Pattern not found.' });
    return;
  }

  const next = { ...existing };
  let changed = false;

  if (payload.name !== undefined) {
    const name = normalizeName(payload.name);
    if (!name) {
      respondJson(r, 400, { error: 'invalid_name', message: 'Name cannot be empty.' });
      return;
    }
    if (name !== existing.name) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.id !== id && item.name === name && item.context === next.context) {
          respondJson(r, 409, { error: 'name_conflict', message: 'Another pattern with this name exists for the same context.' });
          return;
        }
      }
      next.name = name;
      changed = true;
    }
  }

  if (payload.context !== undefined) {
    const context = normalizeContext(payload.context);
    if (!context) {
      respondJson(r, 400, { error: 'invalid_context', message: 'Context must be "request", "response", or "response-stream".' });
      return;
    }
    next.context = context;
    changed = true;
  }

  if (payload.apiKeyName !== undefined) {
    const apiKeyName = normalizeName(payload.apiKeyName);
    if (!apiKeyName) {
      respondJson(r, 400, { error: 'invalid_api_key_name', message: 'apiKeyName cannot be empty.' });
      return;
    }
    const apiKeys = readApiKeys(r);
    if (!findApiKeyByName(apiKeys, apiKeyName)) {
      respondJson(r, 400, { error: 'unknown_api_key', message: 'apiKeyName does not match a configured API key.' });
      return;
    }
    next.apiKeyName = apiKeyName;
    changed = true;
  }

  const nextIsStream = next.context === 'response_stream';

  if (payload.paths !== undefined) {
    const paths = normalizePaths(payload.paths);
    if (nextIsStream) {
      if (paths.length) {
        respondJson(r, 400, { error: 'not_allowed', message: 'Extraction paths cannot be set for response-stream context.' });
        return;
      }
    } else {
      if (!paths.length) {
        respondJson(r, 400, { error: 'invalid_paths', message: 'Provide at least one extraction path.' });
        return;
      }
      next.paths = paths;
      changed = true;
    }
  }

  if (payload.matchers !== undefined) {
    const { matchers, errors } = normalizeMatchers(payload.matchers);
    if (nextIsStream) {
      if (matchers.length) {
        respondJson(r, 400, { error: 'not_allowed', message: 'Matchers cannot be set for response-stream context.' });
        return;
      }
    } else {
      if (errors.length) {
        respondJson(r, 400, { error: 'invalid_matchers', details: errors });
        return;
      }
      next.matchers = matchers;
      changed = true;
    }
  }

  if (payload.notes !== undefined) {
    next.notes = normalizeNotes(payload.notes);
    changed = true;
  }

  if (nextIsStream) {
    if (next.paths.length) {
      next.paths = [];
      changed = true;
    }
    if (next.matchers.length) {
      next.matchers = [];
      changed = true;
    }
  }

  if (!changed) {
    respondJson(r, 200, { item: next, changed: false });
    return;
  }

  next.updated_at = nowIso();

  const updated = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    updated.push(item && item.id === id ? next : item);
  }

  const write = writePatterns(r, updated, { log: 'err', r });
  if (!write.ok) {
    respondJson(r, 500, { error: 'store_failure', message: write.error || 'Unable to persist pattern.' });
    return;
  }

  log({ step: 'patterns:updated', id, context: next.context }, 'info');
  respondJson(r, 200, { item: next, changed: true });
}

async function handleDelete(r, log) {
  const text = await readBody(r);
  const payload = parseBody(text, log);
  if (payload === undefined) {
    respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return;
  }

  const id = payload && payload.id ? String(payload.id).trim() : '';
  if (!id) {
    respondJson(r, 400, { error: 'missing_id', message: 'Provide an id to delete.' });
    return;
  }

  const items = readPatterns(r);
  const filtered = items.filter(item => item && item.id !== id);
  if (filtered.length === items.length) {
    respondJson(r, 404, { error: 'not_found', message: 'Pattern not found.' });
    return;
  }

  const write = writePatterns(r, filtered, { log: 'err', r });
  if (!write.ok) {
    respondJson(r, 500, { error: 'store_failure', message: write.error || 'Unable to persist pattern.' });
    return;
  }

  log({ step: 'patterns:deleted', id }, 'info');
  respondJson(r, 200, { removed: id });
}

function handleOptions(r) {
  r.headersOut['allow'] = 'GET, POST, PATCH, DELETE, OPTIONS';
  r.headersOut['access-control-allow-methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
  r.headersOut['access-control-allow-headers'] = 'content-type';
  r.headersOut['access-control-max-age'] = '300';
  r.return(204, '');
}

async function handle(r) {
  const log = makeLogger({ log: 'info', r });
  try {
    switch (r.method) {
      case 'GET':
        await handleGet(r, log);
        return;
      case 'POST':
        await handlePost(r, log);
        return;
      case 'PATCH':
        await handlePatch(r, log);
        return;
      case 'DELETE':
        await handleDelete(r, log);
        return;
      case 'OPTIONS':
        handleOptions(r);
        return;
      default: {
        log({ step: 'patterns:method_not_allowed', method: r.method }, 'warn');
        r.headersOut['allow'] = 'GET, POST, PATCH, DELETE, OPTIONS';
        respondJson(r, 405, { error: 'method_not_allowed' });
        return;
      }
    }
  } catch (err) {
    log({ step: 'patterns:error', error: safeJson(err && err.stack ? err.stack : String(err)) }, 'err');
    respondJson(r, 500, { error: 'internal_error' });
  }
}
