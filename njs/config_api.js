export default { handle };

import {
  applyConfigPatch,
  clearHostConfig,
  CONFIG_HOST_DEFAULT,
  ensureHostInConfig,
  makeLogger,
  normalizeHostName,
  readConfigHosts,
  readScanConfig,
  removeHostFromConfig,
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

function getHeaderHost(r) {
  const header = r.headersIn && r.headersIn['x-guardrails-config-host'];
  if (header !== undefined && header !== null && header !== '') {
    return normalizeHostName(header);
  }
  const httpHost = r.headersIn && r.headersIn.host;
  if (httpHost) return normalizeHostName(httpHost);
  return CONFIG_HOST_DEFAULT;
}

function ensureHeaderMatchesHost(r, host, log) {
  const target = normalizeHostName(host);
  const headerHost = getHeaderHost(r);
  if (target === CONFIG_HOST_DEFAULT && headerHost === CONFIG_HOST_DEFAULT) {
    return { ok: true, headerHost };
  }
  if (target === headerHost) {
    return { ok: true, headerHost };
  }
  if (log) {
    log({ step: 'config_api:host_mismatch', target, header_host: headerHost }, 'warn');
  }
  return { ok: false, headerHost };
}

async function handleGet(r, log) {
  const host = getHeaderHost(r);
  const config = readScanConfig(r, host);
  const hosts = readConfigHosts(r);
  log({ step: 'config_api:get', host, config });
  respondJson(r, 200, withOptions({ config, host, hosts }));
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

  const targetHost = normalizeHostName(payload && payload.host ? payload.host : getHeaderHost(r));
  const headerCheck = ensureHeaderMatchesHost(r, targetHost, log);
  if (!headerCheck.ok) {
    respondJson(r, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to update.' });
    return;
  }

  const { errors, updates } = validateConfigPatch(payload);
  if (errors.length) {
    log({ step: 'config_api:patch:validation_failed', errors }, 'warn');
    respondJson(r, 400, { error: 'validation_failed', errors });
    return;
  }

  const applied = applyConfigPatch(r, updates, targetHost);
  log({ step: 'config_api:patch:applied', applied }, 'info');

  const applyErrors = [];
  if (applied.inspectModeError) applyErrors.push(applied.inspectModeError);
  if (applied.redactModeError) applyErrors.push(applied.redactModeError);
  if (applied.logLevelError) applyErrors.push(applied.logLevelError);
  if (applied.requestForwardModeError) applyErrors.push(applied.requestForwardModeError);
  if (applied.requestExtractorsError) applyErrors.push(applied.requestExtractorsError);
  if (applied.responseExtractorsError) applyErrors.push(applied.responseExtractorsError);
  if (applied.extractorParallelError) applyErrors.push(applied.extractorParallelError);
  if (applied.responseStreamEnabledError) applyErrors.push(applied.responseStreamEnabledError);
  if (applied.responseStreamChunkSizeError) applyErrors.push(applied.responseStreamChunkSizeError);
  if (applied.responseStreamChunkOverlapError) applyErrors.push(applied.responseStreamChunkOverlapError);
  if (applied.responseStreamFinalEnabledError) applyErrors.push(applied.responseStreamFinalEnabledError);
  if (applied.responseStreamCollectFullEnabledError) applyErrors.push(applied.responseStreamCollectFullEnabledError);
  if (applyErrors.length) {
    log({ step: 'config_api:patch:apply_errors', errors: applyErrors }, 'err');
    respondJson(r, 500, { error: 'apply_failed', details: applyErrors });
    return;
  }

  const config = readScanConfig(r, targetHost);
  const hosts = readConfigHosts(r);
  respondJson(r, 200, withOptions({ config, applied, host: targetHost, hosts }));
}

async function handlePost(r, log) {
  const body = await readRequestBody(r);
  log({ step: 'config_api:post:body', preview: body.slice(0, 200) }, 'debug');

  let payload;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch (err) {
    log({ step: 'config_api:post:parse_error', error: String(err) }, 'warn');
    respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return;
  }

  const hostValue = payload && payload.host ? payload.host : undefined;
  if (!hostValue || typeof hostValue !== 'string') {
    respondJson(r, 400, { error: 'missing_host', message: 'Provide a host field to create a configuration entry.' });
    return;
  }

  const targetHost = normalizeHostName(hostValue);
  const headerCheck = ensureHeaderMatchesHost(r, targetHost, log);
  if (!headerCheck.ok && targetHost !== CONFIG_HOST_DEFAULT) {
    respondJson(r, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to create.' });
    return;
  }

  const hosts = readConfigHosts(r);
  if (hosts.indexOf(targetHost) !== -1) {
    respondJson(r, 409, { error: 'host_exists', message: 'Host already has a configuration entry.' });
    return;
  }

  const ensure = ensureHostInConfig(r, targetHost);
  if (ensure && ensure.error) {
    respondJson(r, 500, { error: 'host_register_failed', message: ensure.error });
    return;
  }

  let applied = { host: targetHost, created: true };
  if (payload && payload.config) {
    const { errors, updates } = validateConfigPatch(payload.config);
    if (errors.length) {
      respondJson(r, 400, { error: 'validation_failed', errors });
      return;
    }
    applied = applyConfigPatch(r, updates, targetHost);
    applied.created = true;
    const createErrors = [];
    if (applied.inspectModeError) createErrors.push(applied.inspectModeError);
    if (applied.redactModeError) createErrors.push(applied.redactModeError);
    if (applied.logLevelError) createErrors.push(applied.logLevelError);
    if (applied.requestForwardModeError) createErrors.push(applied.requestForwardModeError);
    if (applied.requestExtractorsError) createErrors.push(applied.requestExtractorsError);
    if (applied.responseExtractorsError) createErrors.push(applied.responseExtractorsError);
    if (applied.extractorParallelError) createErrors.push(applied.extractorParallelError);
    if (applied.responseStreamEnabledError) createErrors.push(applied.responseStreamEnabledError);
    if (applied.responseStreamChunkSizeError) createErrors.push(applied.responseStreamChunkSizeError);
    if (applied.responseStreamChunkOverlapError) createErrors.push(applied.responseStreamChunkOverlapError);
    if (applied.responseStreamFinalEnabledError) createErrors.push(applied.responseStreamFinalEnabledError);
    if (applied.responseStreamCollectFullEnabledError) createErrors.push(applied.responseStreamCollectFullEnabledError);
    if (createErrors.length) {
      respondJson(r, 500, { error: 'apply_failed', details: createErrors });
      return;
    }
  }

  const config = readScanConfig(r, targetHost);
  const updatedHosts = readConfigHosts(r);
  respondJson(r, 201, withOptions({ config, applied, host: targetHost, hosts: updatedHosts }));
}

async function handleDelete(r, log) {
  const body = await readRequestBody(r);
  let payload = {};
  if (body && body.trim()) {
    try {
      payload = JSON.parse(body);
    } catch (err) {
      log({ step: 'config_api:delete:parse_error', error: String(err) }, 'warn');
      respondJson(r, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
      return;
    }
  }

  const hostValue = payload.host || getHeaderHost(r);
  const targetHost = normalizeHostName(hostValue);
  if (targetHost === CONFIG_HOST_DEFAULT) {
    respondJson(r, 400, { error: 'cannot_delete_default', message: 'The default host cannot be removed.' });
    return;
  }

  const headerCheck = ensureHeaderMatchesHost(r, targetHost, log);
  if (!headerCheck.ok) {
    respondJson(r, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to delete.' });
    return;
  }

  const hostsBefore = readConfigHosts(r);
  if (hostsBefore.indexOf(targetHost) === -1) {
    respondJson(r, 404, { error: 'host_not_found', message: 'Host configuration not found.' });
    return;
  }

  const removal = removeHostFromConfig(r, targetHost);

  const cleared = clearHostConfig(r, targetHost);
  if (cleared && cleared.errors && cleared.errors.length) {
    log({ step: 'config_api:delete:clear_errors', host: targetHost, errors: cleared.errors }, 'err');
    respondJson(r, 500, { error: 'clear_failed', details: cleared.errors });
    return;
  }

  const config = readScanConfig(r, CONFIG_HOST_DEFAULT);
  const hosts = readConfigHosts(r);
  respondJson(r, 200, withOptions({ config, host: CONFIG_HOST_DEFAULT, hosts, removed: targetHost }));
}



function handleOptions(r) {
  r.headersOut['allow'] = 'GET, PATCH, POST, DELETE, OPTIONS';
  r.headersOut['access-control-allow-methods'] = 'GET, PATCH, POST, DELETE, OPTIONS';
  r.headersOut['access-control-allow-headers'] = 'content-type, x-guardrails-config-host';
  r.headersOut['access-control-max-age'] = '300';
  r.return(204, '');
}

async function handle(r) {
  const method = r.method;
  const ensureHost = !(method === 'POST' || method === 'DELETE');
  const kv = readScanConfig(r, undefined, { ensure: ensureHost });
  const log = makeLogger({ log: kv.logLevel || 'info', r });
  try {
    switch (method) {
      case 'GET':
        await handleGet(r, log);
        return;
      case 'PATCH':
        await handlePatch(r, log);
        return;
      case 'POST':
        await handlePost(r, log);
        return;
      case 'DELETE':
        await handleDelete(r, log);
        return;
      case 'OPTIONS':
        handleOptions(r);
        return;
      default:
        log({ step: 'config_api:method_not_allowed', method: r.method }, 'warn');
        r.headersOut['allow'] = 'GET, PATCH, POST, DELETE, OPTIONS';
        respondJson(r, 405, { error: 'method_not_allowed' });
        return;
    }
  } catch (err) {
    log({ step: 'config_api:error', error: safeJson(err && err.stack ? err.stack : String(err)) }, 'err');
    respondJson(r, 500, { error: 'internal_error' });
  }
}
