export default { handle };

import {
  applyConfigPatch,
  makeLogger,
  readScanConfig,
  safeJson,
  SCAN_CONFIG_DEFAULTS,
  SCAN_CONFIG_ENUMS,
  validateConfigPatch
} from './utils.js';

function respondJson(r, status, payload) {
  r.headersOut['content-type'] = 'application/json; charset=utf-8';
  r.headersOut['cache-control'] = 'no-store';
  r.return(status, JSON.stringify(payload));
}

function withOptions(payload) {
  return {
    ...payload,
    options: {
      inspectMode: SCAN_CONFIG_ENUMS.inspectMode,
      redactMode: SCAN_CONFIG_ENUMS.redactMode,
      logLevel: SCAN_CONFIG_ENUMS.logLevel,
      requestForwardMode: SCAN_CONFIG_ENUMS.requestForwardMode
    },
    defaults: SCAN_CONFIG_DEFAULTS
  };
}

async function handleGet(r, log) {
  const config = readScanConfig(r);
  log({ step: 'config_api:get', config });
  respondJson(r, 200, withOptions({ config }));
}

async function readRequestBody(r) {
  if (r.requestBuffer !== undefined) {
    return r.requestBuffer.toString('utf8');
  }
  if (r.requestText !== undefined) {
    return String(r.requestText);
  }
  return '';
}

async function handlePatch(r, log) {
  const body = await readRequestBody(r);
  log({ step: 'config_api:patch:body', preview: body.slice(0, 200) }, 'debug');

  let payload;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch (err) {
    log({ step: 'config_api:patch:parse_error', error: String(err) }, 'warn');
    respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return;
  }

  const { errors, updates } = validateConfigPatch(payload);
  if (errors.length) {
    log({ step: 'config_api:patch:validation_failed', errors }, 'warn');
    respondJson(r, 400, { error: 'validation_failed', errors });
    return;
  }

  const applied = applyConfigPatch(r, updates);
  log({ step: 'config_api:patch:applied', applied }, 'info');

  const applyErrors = [];
  if (applied.inspectModeError) applyErrors.push(applied.inspectModeError);
  if (applied.redactModeError) applyErrors.push(applied.redactModeError);
  if (applied.logLevelError) applyErrors.push(applied.logLevelError);
  if (applied.requestPathsError) applyErrors.push(applied.requestPathsError);
  if (applied.responsePathsError) applyErrors.push(applied.responsePathsError);
  if (applied.requestForwardModeError) applyErrors.push(applied.requestForwardModeError);
  if (applyErrors.length) {
    log({ step: 'config_api:patch:apply_errors', errors: applyErrors }, 'err');
    respondJson(r, 500, { error: 'apply_failed', details: applyErrors });
    return;
  }

  const config = readScanConfig(r);
  respondJson(r, 200, withOptions({ config, applied }));
}

function handleOptions(r) {
  r.headersOut['allow'] = 'GET, PATCH, OPTIONS';
  r.headersOut['access-control-allow-methods'] = 'GET, PATCH, OPTIONS';
  r.headersOut['access-control-allow-headers'] = 'content-type';
  r.headersOut['access-control-max-age'] = '300';
  r.return(204, '');
}

async function handle(r) {
  const kv = readScanConfig(r);
  const log = makeLogger({ log: kv.logLevel || 'info', r });
  try {
    switch (r.method) {
      case 'GET':
        await handleGet(r, log);
        return;
      case 'PATCH':
      case 'POST':
        await handlePatch(r, log);
        return;
      case 'OPTIONS':
        handleOptions(r);
        return;
      default:
        log({ step: 'config_api:method_not_allowed', method: r.method }, 'warn');
        r.headersOut['allow'] = 'GET, PATCH, OPTIONS';
        respondJson(r, 405, { error: 'method_not_allowed' });
        return;
    }
  } catch (err) {
    log({ step: 'config_api:error', error: safeJson(err && err.stack ? err.stack : String(err)) }, 'err');
    respondJson(r, 500, { error: 'internal_error' });
  }
}
