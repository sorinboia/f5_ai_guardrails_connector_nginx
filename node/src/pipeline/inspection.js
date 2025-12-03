import { getHeaderHost } from '../routes/helpers.js';
import { resolveConfig, normalizeHostName } from '../config/validate.js';
import { defaultStore } from '../config/store.js';
import { callSideband } from './sidebandClient.js';
import { sanitizeBlockingResponse } from '../routes/management.js';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function getPathValue(obj, path) {
  if (!path || !obj) return undefined;
  const trimmed = path.startsWith('.') ? path.slice(1) : path;
  const parts = trimmed.split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    const m = part.match(/(.+)\[(\-?\d+)\]$/);
    if (m) {
      const key = m[1];
      const idx = Number(m[2]);
      current = current[key];
      if (!Array.isArray(current)) return undefined;
      const index = idx === -1 ? current.length - 1 : idx;
      current = current[index];
    } else {
      current = current[part];
    }
  }
  return current;
}

function evaluateMatchers(parsed, matchers = []) {
  if (!matchers.length) return { matched: true };
  if (!parsed) return { matched: false, reason: 'no_json' };

  for (let i = 0; i < matchers.length; i++) {
    const m = matchers[i];
    if (!m || typeof m.path !== 'string') return { matched: false, reason: 'invalid_matcher', index: i };
    const value = getPathValue(parsed, m.path);
    const exists = value !== undefined;
    if (m.exists === true && !exists) return { matched: false, reason: 'exists_false', path: m.path };
    if (m.equals !== undefined && value !== m.equals) return { matched: false, reason: 'equals_mismatch', path: m.path };
    if (m.contains !== undefined) {
      const str = value === undefined || value === null ? '' : String(value);
      if (!str.includes(m.contains)) return { matched: false, reason: 'contains_mismatch', path: m.path };
    }
  }
  return { matched: true };
}

function selectPatternAndKey(bodyText, patterns, apiKeys) {
  const parsed = parseJson(bodyText);
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const evalResult = evaluateMatchers(parsed, pattern.matchers || []);
    if (!evalResult.matched) continue;
    const apiKey = apiKeys.find((k) => k.name === pattern.apiKeyName);
    return { pattern, apiKey };
  }
  return { pattern: undefined, apiKey: undefined };
}

function pickPatterns(config, store, context) {
  const key = context === 'response' ? 'responseExtractors' : 'requestExtractors';
  const ids = Array.isArray(config[key]) ? config[key] : [];
  return ids
    .map((id) => store.patterns.find((p) => p.id === id && p.context === context))
    .filter(Boolean);
}

function buildSidebandPayload(bodyText) {
  return JSON.stringify({
    input: bodyText,
    configOverrides: {},
    forceEnabled: [],
    disabled: [],
    verbose: false
  });
}

function parseOutcome(status, text) {
  const json = parseJson(text) || {};
  const outcome = (json.result && json.result.outcome) ? String(json.result.outcome).toLowerCase() : '';
  return { outcome, json, status, text };
}

function blockingResponseForKey(store, apiKeyName) {
  if (!apiKeyName) return sanitizeBlockingResponse();
  const record = store.apiKeys.find((k) => k.name === apiKeyName);
  if (!record) return sanitizeBlockingResponse();
  return sanitizeBlockingResponse(record.blockingResponse);
}

export function buildInspectionPreHandler(fastify) {
  const appCfg = fastify.appConfig;
  return async function inspectionPreHandler(request, reply) {
    const store = fastify.store || defaultStore();
    const host = getHeaderHost(request);
    const config = resolveConfig(store, host);
    request.sidebandContext = request.sidebandContext || {};
    request.sidebandContext.config = { host, config };

    const inspectRequest = ['both', 'request', 'on', 'true'].includes((config.inspectMode || '').toLowerCase());
    if (!inspectRequest) return;

    let bodyText = '';
    if (Buffer.isBuffer(request.body)) bodyText = request.body.toString('utf8');
    else if (typeof request.body === 'string') bodyText = request.body;
    else if (request.body && typeof request.body === 'object') bodyText = JSON.stringify(request.body);

    const patterns = pickPatterns(config, store, 'request');
    const { pattern, apiKey } = selectPatternAndKey(bodyText, patterns, store.apiKeys || []);

    const bearer = (apiKey && apiKey.key) || appCfg.sidebandBearer || '';
    if (!bearer) {
      request.log.warn({ step: 'sideband:skip_no_bearer', host }, 'No bearer available; skipping inspection');
      return;
    }

    const payload = buildSidebandPayload(bodyText);
    const { status, text } = await callSideband({
      url: appCfg.sidebandUrl,
      bearer,
      payload,
      timeoutMs: appCfg.sidebandTimeoutMs,
      caBundle: appCfg.caBundle,
      testsLocalOverride: appCfg.testsLocalSideband,
      hostHeader: request.headers.host,
      logger: request.log
    });

    const { outcome } = parseOutcome(status, text);
    request.log.info({ step: 'sideband:decision', outcome, status }, 'Sideband outcome');

    if (outcome === 'flagged' || outcome === 'redacted') {
      const block = blockingResponseForKey(store, apiKey ? apiKey.name : undefined);
      reply
        .code(block.status || 200)
        .header('content-type', block.contentType || 'application/json; charset=utf-8')
        .send(block.body || '');
      return reply;
    }
  };
}
