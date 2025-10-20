export default { handle };

import { makeLogger, safeJson } from './utils.js';
import { readApiKeys, writeApiKeys, findApiKeyByName } from './config_store.js';

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
    log({ step: 'api_keys:parse_error', error: String(err) }, 'warn');
    return undefined;
  }
}

function normalizeName(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeKey(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function generateId() {
  const seed = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e8).toString(36);
  return `ak_${seed}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function handleGet(r, log) {
  const items = readApiKeys(r);
  log({ step: 'api_keys:get', count: items.length }, 'debug');
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
  const key = normalizeKey(payload.key);

  if (!name) {
    respondJson(r, 400, { error: 'missing_name', message: 'Provide a non-empty name.' });
    return;
  }

  if (!key) {
    respondJson(r, 400, { error: 'missing_key', message: 'Provide a non-empty key.' });
    return;
  }

  const records = readApiKeys(r);
  if (findApiKeyByName(records, name)) {
    respondJson(r, 409, { error: 'name_conflict', message: 'Name already exists.' });
    return;
  }

  const record = {
    id: generateId(),
    name,
    key,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  records.push(record);

  const write = writeApiKeys(r, records, { log: 'err', r });
  if (!write.ok) {
    respondJson(r, 500, { error: 'store_failure', message: write.error || 'Unable to persist API key.' });
    return;
  }

  log({ step: 'api_keys:created', id: record.id, name }, 'info');
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

  const records = readApiKeys(r);
  let targetIndex = -1;
  for (let i = 0; i < records.length; i++) {
    if (records[i] && records[i].id === id) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    respondJson(r, 404, { error: 'not_found', message: 'API key not found.' });
    return;
  }

  const record = { ...records[targetIndex] };
  let changed = false;

  if (payload.name !== undefined) {
    const name = normalizeName(payload.name);
    if (!name) {
      respondJson(r, 400, { error: 'invalid_name', message: 'Name cannot be empty.' });
      return;
    }
    if (name !== record.name && findApiKeyByName(records, name)) {
      respondJson(r, 409, { error: 'name_conflict', message: 'Name already exists.' });
      return;
    }
    record.name = name;
    changed = true;
  }

  if (payload.key !== undefined) {
    const key = normalizeKey(payload.key);
    if (!key) {
      respondJson(r, 400, { error: 'invalid_key', message: 'Key cannot be empty.' });
      return;
    }
    record.key = key;
    changed = true;
  }

  if (!changed) {
    respondJson(r, 200, { item: record, changed: false });
    return;
  }

  record.updated_at = nowIso();
  records[targetIndex] = record;

  const write = writeApiKeys(r, records, { log: 'err', r });
  if (!write.ok) {
    respondJson(r, 500, { error: 'store_failure', message: write.error || 'Unable to persist API key.' });
    return;
  }

  log({ step: 'api_keys:updated', id, name: record.name }, 'info');
  respondJson(r, 200, { item: record, changed: true });
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

  const records = readApiKeys(r);
  const filtered = records.filter(item => item && item.id !== id);

  if (filtered.length === records.length) {
    respondJson(r, 404, { error: 'not_found', message: 'API key not found.' });
    return;
  }

  const write = writeApiKeys(r, filtered, { log: 'err', r });
  if (!write.ok) {
    respondJson(r, 500, { error: 'store_failure', message: write.error || 'Unable to persist API key.' });
    return;
  }

  log({ step: 'api_keys:deleted', id }, 'info');
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
        log({ step: 'api_keys:method_not_allowed', method: r.method }, 'warn');
        r.headersOut['allow'] = 'GET, POST, PATCH, DELETE, OPTIONS';
        respondJson(r, 405, { error: 'method_not_allowed' });
        return;
      }
    }
  } catch (err) {
    log({ step: 'api_keys:error', error: safeJson(err && err.stack ? err.stack : String(err)) }, 'err');
    respondJson(r, 500, { error: 'internal_error' });
  }
}
