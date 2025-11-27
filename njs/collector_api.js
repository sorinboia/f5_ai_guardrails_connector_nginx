export default { handle };

import { clearCollection, readCollectorState, scheduleCollection } from './collector_store.js';
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
    log({ step: 'collector_api:parse_error', error: String(err) }, 'warn');
    return undefined;
  }
}

function normalizeCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  const int = Math.floor(num);
  return int >= 0 ? int : undefined;
}

async function handleGet(r, log) {
  const state = readCollectorState(r, { log: 'debug', r });
  log({ step: 'collector_api:get', state: safeJson(state) }, 'debug');
  respondJson(r, 200, state);
}

async function handlePost(r, log) {
  const text = await readBody(r);
  const payload = parseBody(text, log);
  if (payload === undefined) {
    respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return;
  }

  const action = payload.action ? String(payload.action).toLowerCase() : 'collect';

  if (action === 'clear') {
    const cleared = clearCollection(r, { log: 'info', r });
    respondJson(r, 200, cleared);
    return;
  }

  const count = normalizeCount(payload.count !== undefined ? payload.count : payload.collect);
  if (count === undefined) {
    respondJson(r, 400, { error: 'invalid_count', message: 'Provide a non-negative integer count.' });
    return;
  }

  const state = scheduleCollection(r, count, { log: 'info', r });
  respondJson(r, 200, state);
}

function handleOptions(r) {
  r.headersOut['allow'] = 'GET, POST, OPTIONS';
  r.headersOut['access-control-allow-methods'] = 'GET, POST, OPTIONS';
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
      case 'OPTIONS':
        handleOptions(r);
        return;
      default:
        log({ step: 'collector_api:method_not_allowed', method: r.method }, 'warn');
        r.headersOut['allow'] = 'GET, POST, OPTIONS';
        respondJson(r, 405, { error: 'method_not_allowed' });
        return;
    }
  } catch (err) {
    log({ step: 'collector_api:error', error: safeJson(err && err.stack ? err.stack : String(err)) }, 'err');
    respondJson(r, 500, { error: 'internal_error' });
  }
}
