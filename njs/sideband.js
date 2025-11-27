export default { handle };

import { getPathAccessor, isModeEnabled, makeLogger, readScanConfig, readVar, safeJson, safeJsonParse } from './utils.js';
import { callSideband } from './sideband_client.js';
import { applyRedactions, collectRedactionPlan, extractContextPayload } from './redaction.js';
import { recordSample } from './collector_store.js';
import { findApiKeyByName, findPatternById, readApiKeys, readPatterns } from './config_store.js';

/* ----------------------------- Configuration ------------------------------ */

const SIDEBAND_URL_DEFAULT    = 'https://www.us1.calypsoai.app/backend/v1/scans';
const SIDEBAND_UA_DEFAULT     = 'njs-sideband/1.0';
const SIDEBAND_BEARER_DEFAULT =
  'MDE5OThmNmEtMTE5ZS03MDdkLTg5OTktMTU0NDgzYzNiNDA4/FsEqxzRtAxO6oXwyEKEwI9GGf5qjGJu7owwKjUNXRkUVkkoxFbeXJpedcHZY9YsQC9aNOSj75dTOhKJA';
const SIDEBAND_TIMEOUT_DEFAULT = 5000; // ms

const BACKEND_ORIGIN_DEFAULT = 'https://api.openai.com';

const REQUEST_PATHS_DEFAULT  = ['.messages[-1].content'];
const RESPONSE_PATHS_DEFAULT = ['.message.content'];

const DEFAULT_LOG_LEVEL   = 'info';
const DEFAULT_INSPECT_MODE = 'both';
const DEFAULT_REDACT_MODE  = 'both';
const DEFAULT_FORWARD_MODE = 'sequential';

function resolvePattern(patterns, id, expectedContext) {
  if (!id) return undefined;
  const trimmed = String(id).trim();
  if (!trimmed) return undefined;
  const record = findPatternById(patterns, trimmed);
  if (!record) return undefined;
  if (expectedContext) {
    const ctx = record.context || '';
    const matches =
      ctx === expectedContext ||
      (expectedContext === 'response' && ctx === 'response_stream') ||
      (expectedContext === 'response_stream' && (ctx === 'response_stream' || ctx === 'response'));
    if (!matches) {
      return undefined;
    }
  }
  return record;
}

function evaluateMatchers(parsed, matchers) {
  if (!Array.isArray(matchers) || !matchers.length) {
    return { matched: true, reason: 'no_matchers' };
  }

  for (let i = 0; i < matchers.length; i++) {
    const matcher = matchers[i];
    if (!matcher || typeof matcher.path !== 'string') {
      return { matched: false, reason: 'invalid_matcher', index: i };
    }
    const accessor = getPathAccessor(parsed, matcher.path, { log: false });
    const value = accessor ? accessor.value : undefined;
    const exists = accessor !== undefined;

    if (matcher.exists === true && !exists) {
      return { matched: false, reason: 'exists_false', path: matcher.path };
    }

    if (matcher.equals !== undefined) {
      const equalsTarget = matcher.equals;
      if (value !== equalsTarget) {
        return {
          matched: false,
          reason: 'equals_mismatch',
          path: matcher.path,
          expected: equalsTarget,
          actual: value
        };
      }
    }

    if (matcher.contains !== undefined) {
      const containsTarget = matcher.contains;
      const str = value === undefined || value === null ? '' : String(value);
      if (str.indexOf(containsTarget) === -1) {
        return {
          matched: false,
          reason: 'contains_mismatch',
          path: matcher.path,
          expected: containsTarget,
          actual: value
        };
      }
    }
  }

  return { matched: true };
}

function selectApiKeyForPattern(context, pattern, apiKeys, defaultBearer, log, phase) {
  if (!pattern) {
    return { bearer: defaultBearer, matched: true, shouldRun: true };
  }

  const parsed = context && context.parsed;
  let evaluation = { matched: true, reason: 'no_matchers' };

  if (Array.isArray(pattern.matchers) && pattern.matchers.length) {
    if (!parsed) {
      log({ step: `${phase}:pattern_no_json`, pattern_id: pattern.id }, 'debug');
      return {
        bearer: defaultBearer,
        matched: false,
        shouldRun: false,
        patternId: pattern.id,
        apiKeyName: pattern.apiKeyName
      };
    }
    evaluation = evaluateMatchers(parsed, pattern.matchers);
  } else {
    log({ step: `${phase}:pattern_no_matchers`, pattern_id: pattern.id }, 'debug');
  }

  if (!evaluation.matched) {
    log({
      step: `${phase}:pattern_miss`,
      pattern_id: pattern.id,
      reason: evaluation.reason,
      path: evaluation.path || null
    }, 'debug');
    return {
      bearer: defaultBearer,
      matched: false,
      shouldRun: false,
      patternId: pattern.id,
      apiKeyName: pattern.apiKeyName
    };
  }

  const record = findApiKeyByName(apiKeys, pattern.apiKeyName);
  if (!record || !record.key) {
    log({
      step: `${phase}:pattern_key_missing`,
      pattern_id: pattern.id,
      api_key_name: pattern.apiKeyName
    }, 'warn');
    return {
      bearer: defaultBearer,
      matched: true,
      shouldRun: true,
      patternId: pattern.id,
      apiKeyName: pattern.apiKeyName
    };
  }

  log({
    step: `${phase}:pattern_match`,
    pattern_id: pattern.id,
    api_key_name: record.name
  }, 'info');
  return {
    bearer: record.key,
    matched: true,
    shouldRun: true,
    apiKeyName: record.name,
    patternId: pattern.id
  };
}

function logPatternResult(log, phase, result) {
  if (!result) return;
  if (!result.patternId && !result.apiKeyName) return;
  log({
    step: `${phase}:pattern_result`,
    pattern_id: result.patternId || null,
    api_key_name: result.apiKeyName || null,
    status: result.status
  }, 'debug');
}

/* --------------------------- Response helpers ----------------------------- */

const DEFAULT_BLOCK_MESSAGE = 'F5 AI Guardrails blocked this request';
const STREAM_CHUNK_SIZE_DEFAULT = 2048;
const STREAM_CHUNK_OVERLAP_DEFAULT = 128;

function defaultBlockingResponse() {
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      message: {
        role: 'assistant',
        content: DEFAULT_BLOCK_MESSAGE
      }
    })
  };
}

function sanitizeBlockingResponse(value) {
  const defaults = defaultBlockingResponse();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const response = {
    status: defaults.status,
    contentType: defaults.contentType,
    body: defaults.body
  };

  if (value.status !== undefined) {
    const num = Number(value.status);
    if (Number.isFinite(num)) {
      const status = Math.trunc(num);
      if (status >= 100 && status <= 999) {
        response.status = status;
      }
    }
  }

  if (value.contentType !== undefined) {
    const ct = String(value.contentType).trim();
    if (ct) {
      response.contentType = ct;
    }
  }

  if (value.body !== undefined) {
    if (typeof value.body === 'string') {
      response.body = value.body;
    } else if (value.body && typeof value.body === 'object') {
      try {
        response.body = JSON.stringify(value.body);
      } catch (_) {
        /* keep default */
      }
    }
  }

  return response;
}

function resolveBlockingResponse(apiKeys, apiKeyName) {
  if (!apiKeyName) {
    return defaultBlockingResponse();
  }
  const record = findApiKeyByName(Array.isArray(apiKeys) ? apiKeys : [], apiKeyName);
  if (!record) {
    return defaultBlockingResponse();
  }
  return sanitizeBlockingResponse(record.blockingResponse);
}

function blockAndReturn(r, log, opts) {
  const outcome = opts && opts.outcome ? opts.outcome : 'blocked';
  const extra = opts && opts.extra ? opts.extra : undefined;
  const apiKeys = opts && opts.apiKeys ? opts.apiKeys : [];
  const providedName = opts && opts.apiKeyName ? opts.apiKeyName : undefined;
  const fallbackName = extra && typeof extra === 'object' ? extra.api_key_name : undefined;
  const apiKeyName = providedName || fallbackName;
  const blockingResponse = resolveBlockingResponse(apiKeys, apiKeyName);
  const extraPreview = extra && typeof extra === 'object'
    ? safeJson(extra).slice(0, 200)
    : (extra !== undefined ? String(extra).slice(0, 200) : undefined);

  if (blockingResponse.contentType) {
    r.headersOut['content-type'] = blockingResponse.contentType;
  }

  log({
    step: 'block',
    outcome,
    api_key_name: apiKeyName || null,
    pattern_id: opts && opts.patternId ? opts.patternId : null,
    phase: opts && opts.phase ? opts.phase : null,
    extra_preview: extraPreview
  }, 'info');

  r.return(blockingResponse.status, blockingResponse.body);
}

/* --------------------------- Pipeline helpers ----------------------------- */

function extractStreamDelta(obj) {
  if (!obj || typeof obj !== 'object') return '';

  if (Array.isArray(obj.choices) && obj.choices.length) {
    const choice = obj.choices[0];
    if (choice && choice.delta && typeof choice.delta.content === 'string') {
      return choice.delta.content;
    }
    if (choice && choice.message && typeof choice.message.content === 'string') {
      return choice.message.content;
    }
  }

  if (typeof obj.delta === 'string') {
    return obj.delta;
  }

  if (obj.response && Array.isArray(obj.response.output) && obj.response.output.length) {
    const first = obj.response.output[0];
    if (first && Array.isArray(first.content) && first.content.length) {
      const content = first.content[0];
      if (content && typeof content.text === 'string') {
        return content.text;
      }
      if (content && content.text && typeof content.text.value === 'string') {
        return content.text.value;
      }
    }
  }

  return '';
}

function parseStreamingBody(bodyText, headers, log) {
  const result = { assembled: '', events: 0 };
  if (!bodyText || typeof bodyText !== 'string') {
    return result;
  }

  const contentType = headers && typeof headers['content-type'] === 'string'
    ? headers['content-type'].toLowerCase()
    : '';
  const looksLikeSse = contentType.indexOf('text/event-stream') !== -1 || bodyText.indexOf('data:') !== -1;

  if (!looksLikeSse) {
    return result;
  }

  const lines = bodyText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('data:') !== 0) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    const parsed = safeJsonParse(payload);
    if (!parsed) continue;
    const delta = extractStreamDelta(parsed);
    if (!delta) continue;
    result.assembled += delta;
    result.events += 1;
  }

  if (result.events) {
    log({
      step: 'stream:parsed',
      events: result.events,
      total_chars: result.assembled.length
    }, 'debug');
    log({
      step: 'stream:assembled',
      preview: result.assembled.slice(0, 512),
      preview_chars: Math.min(result.assembled.length, 512)
    }, 'info');
  }
  return result;
}

function sliceTextChunks(text, size, overlap) {
  const out = [];
  if (!text || size <= 0) return out;
  const ov = overlap < 0 ? 0 : overlap;
  const effOverlap = ov >= size ? size - 1 : ov;
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    out.push(text.slice(start, end));
    if (end === text.length) break; // avoid infinite loop when text shorter than chunk size
    const nextStart = end - effOverlap;
    // guard against non-advancing or negative start when text is shorter than overlap
    if (nextStart <= start) {
      start = end;
    } else {
      start = nextStart;
    }
  }
  return out;
}

function buildStreamMessageBody(text) {
  return JSON.stringify({ message: { content: text } });
}

function getRequestBody(r, log) {
  let bodyText = '';
  let bodySource = 'request_text';

  try {
    if (r.requestText !== undefined && r.requestText !== null) {
      bodyText = String(r.requestText);
    } else if (r.requestBuffer !== undefined && r.requestBuffer !== null) {
      bodyText = r.requestBuffer.toString('utf8');
      bodySource = 'request_buffer';
    } else {
      bodySource = 'unavailable';
    }
  } catch (err) {
    bodySource = 'error';
    log({ step: 'body:read_error', error: String(err) }, 'err');
  }

  log(`body length=${bodyText.length}B source=${bodySource}`, 'debug');
  log({ bodyPreview: bodyText.slice(0, 512) }, 'debug');
  return { bodyText };
}

function buildSidebandPayload(input) {
  return JSON.stringify({
    input,
    configOverrides: {},
    forceEnabled: [],
    disabled: [],
    verbose: false
  });
}

function parseSidebandOutcome(sbStatus, sbText) {
  const sbJson  = safeJsonParse(sbText) || {};
  const outcome = (((sbJson || {}).result) || {}).outcome;
  return { outcome, sbJson };
}

function normalizeOutcome(outcome) {
  return String(outcome || '').toLowerCase();
}

async function runInspectionPhase(opts) {
  const {
    phase,
    bodyText,
    paths,
    inspectEnabled,
    redactEnabled,
    log,
    sideband,
    pattern,
    apiKeys
  } = opts;

  if (!inspectEnabled) {
    return {
      status: 'skipped',
      bodyText,
      apiKeyName: undefined,
      patternId: pattern ? pattern.id : undefined
    };
  }

  const context = extractContextPayload(bodyText, paths, log, phase);
  const keyDecision = selectApiKeyForPattern(
    context,
    pattern,
    Array.isArray(apiKeys) ? apiKeys : [],
    sideband.bearer,
    log,
    phase
  );

  const shouldRun = keyDecision && keyDecision.shouldRun !== undefined ? keyDecision.shouldRun : true;
  if (!shouldRun) {
    return {
      status: 'skipped_no_match',
      bodyText,
      apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
      patternId: pattern ? pattern.id : undefined
    };
  }

  const payload = buildSidebandPayload(context.extracted);
  log({ step: `${phase}:sideband_call_start`, timeout_ms: sideband.timeout, api_key_name: keyDecision.apiKeyName || null }, 'info');
  const started = Date.now();
  const { status: sbStatus, text: sbText } =
    await callSideband(log, sideband.url, keyDecision.bearer, sideband.ua, payload, sideband.timeout);
  log({ step: `${phase}:sideband_call_done`, status: sbStatus, ms: Date.now() - started }, 'info');

  const { outcome, sbJson } = parseSidebandOutcome(sbStatus, sbText);
  const normalizedOutcome = normalizeOutcome(outcome);

  if (normalizedOutcome === 'flagged') {
    return {
      status: 'blocked',
      outcome: normalizedOutcome,
      details: {
        sideband_status: sbStatus,
        sideband_preview: (sbText || '').substring(0, 512),
        reason: `${phase} outcome flagged`,
        pattern_id: pattern ? pattern.id : undefined,
        api_key_name: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined
      },
      apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
      patternId: pattern ? pattern.id : undefined
    };
  }

  if (normalizedOutcome === 'redacted') {
    if (!redactEnabled) {
      return {
        status: 'blocked',
        outcome: normalizedOutcome,
        details: {
          sideband_status: sbStatus,
          sideband_preview: (sbText || '').substring(0, 512),
          reason: `${phase} redaction disabled`,
          pattern_id: pattern ? pattern.id : undefined,
          api_key_name: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined
        },
        apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
        patternId: pattern ? pattern.id : undefined
      };
    }

    const plan = collectRedactionPlan(sbJson);
    let redaction = {
      applied: plan.matches.length === 0,
      unmatched: 0,
      text: undefined
    };

    if (plan.matches.length) {
      redaction = applyRedactions(context, plan.matches, log, phase);
    } else {
      log({ step: `${phase}:redaction_skipped`, reason: 'no regex matches returned' }, 'info');
    }

    const redactionOk =
      redaction.applied &&
      redaction.unmatched === 0 &&
      plan.unsupported.length === 0;

    log({
      step: `${phase}:redaction_status`,
      failed_scanners: plan.failedCount,
      matches: plan.matches.length,
      unsupported: plan.unsupported.length,
      applied: redaction.applied,
      unmatched: redaction.unmatched,
      success: redactionOk
    }, 'info');

    if (!redactionOk) {
      return {
        status: 'blocked',
        outcome: normalizedOutcome,
        details: {
          sideband_status: sbStatus,
          sideband_preview: (sbText || '').substring(0, 512),
          failed_scanners: plan.failedCount,
          unsupported_scanners: plan.unsupported,
          redacted: redaction.applied || false,
          unmatched_matches: redaction.unmatched,
          pattern_id: pattern ? pattern.id : undefined,
          api_key_name: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined
        },
        apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
        patternId: pattern ? pattern.id : undefined
      };
    }

    return {
      status: 'redacted',
      outcome: normalizedOutcome,
      bodyText: redaction.text !== undefined ? redaction.text : bodyText,
      apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
      patternId: pattern ? pattern.id : undefined
    };
  }

  if (normalizedOutcome && normalizedOutcome !== 'cleared') {
    return {
      status: 'blocked',
      outcome: normalizedOutcome,
      details: {
        sideband_status: sbStatus,
        sideband_preview: (sbText || '').substring(0, 512),
        reason: `unexpected ${phase} outcome: ${normalizedOutcome}`,
        pattern_id: pattern ? pattern.id : undefined,
        api_key_name: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined
      },
      apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
      patternId: pattern ? pattern.id : undefined
    };
  }

  return {
    status: 'cleared',
    outcome: normalizedOutcome,
    bodyText,
    apiKeyName: keyDecision && keyDecision.apiKeyName ? keyDecision.apiKeyName : undefined,
    patternId: pattern ? pattern.id : undefined
  };
}

async function fetchBackend(r, log, bodyText, backendOrigin) {
  const origin = backendOrigin || readVar(r, 'backend_origin_effective', BACKEND_ORIGIN_DEFAULT);
  const args = r.variables && r.variables.args ? r.variables.args : '';
  const opt  = { method: r.method, body: bodyText, args };
  const upstreamPath = r.uri || '';
  const upstreamFullPath = upstreamPath + (args ? `?${args}` : '');
  log({
    step: 'backend:subrequest',
    method: opt.method,
    upstream_origin: origin,
    upstream_path: upstreamFullPath,
    args: args || ''
  }, 'info');

  const resp = await r.subrequest('/backend' + upstreamPath, opt);

  const status  = resp.status;
  const headers = resp.headersOut || {};
  const body    = (resp.responseBody !== undefined) ? resp.responseBody
                : (resp.responseText !== undefined ? resp.responseText : '');

  log({ step: 'backend:response', status, hdrs_sample: Object.keys(headers).slice(0, 6) }, 'debug');
  return { status, headers, body };
}

function sendBackendToClient(r, backend, log) {
  for (const k in backend.headers) {
    try {
      r.headersOut[k] = backend.headers[k];
    } catch (_) { /* ignore header set failures */ }
  }
  log({ step: 'client:return', status: backend.status }, 'debug');
  r.return(backend.status, backend.body || '');
}

/* -------------------------------- Handler --------------------------------- */

async function handle(r) {
  const scanConfig     = readScanConfig(r);
  const configLogLevel = scanConfig.logLevel || DEFAULT_LOG_LEVEL;
  const varLevel       = readVar(r, 'sideband_log', configLogLevel);
  const inspectBase    = scanConfig.inspectMode || DEFAULT_INSPECT_MODE;
  const inspectModeVar = readVar(r, 'sideband_inspect', inspectBase);
  const inspectMode    = String(inspectModeVar).toLowerCase();
  const redactBase     = scanConfig.redactMode || DEFAULT_REDACT_MODE;
  const redactModeVar  = readVar(r, 'sideband_redact', redactBase);
  const redactMode     = String(redactModeVar).toLowerCase();
  const requestFallbackPaths = (scanConfig.requestPaths && scanConfig.requestPaths.length)
    ? scanConfig.requestPaths
    : REQUEST_PATHS_DEFAULT;
  const responseFallbackPaths = (scanConfig.responsePaths && scanConfig.responsePaths.length)
    ? scanConfig.responsePaths
    : RESPONSE_PATHS_DEFAULT;
  const forwardBase    = scanConfig.requestForwardMode || DEFAULT_FORWARD_MODE;
  const forwardModeVar = readVar(r, 'sideband_request_forward', forwardBase);
  const requestForwardMode = String(forwardModeVar).toLowerCase();
  const responseStreamEnabled = !!scanConfig.responseStreamEnabled;
  const responseStreamChunkSize = scanConfig.responseStreamChunkSize || STREAM_CHUNK_SIZE_DEFAULT;
  let responseStreamChunkOverlap = scanConfig.responseStreamChunkOverlap || STREAM_CHUNK_OVERLAP_DEFAULT;
  if (responseStreamChunkOverlap >= responseStreamChunkSize) {
    responseStreamChunkOverlap = responseStreamChunkSize > 1 ? responseStreamChunkSize - 1 : 0;
  }
  const responseStreamFinalEnabled = (scanConfig.responseStreamFinalEnabled === undefined)
    ? true
    : !!scanConfig.responseStreamFinalEnabled;
  const responseStreamCollectFullEnabled = !!scanConfig.responseStreamCollectFullEnabled;
  const backendOrigin = scanConfig.backendOrigin || BACKEND_ORIGIN_DEFAULT;
  try {
    r.variables.backend_origin_effective = backendOrigin;
  } catch (_) {
    /* best-effort; subrequest will fall back to js_set */
  }

  const apiKeys = readApiKeys(r);
  const patterns = readPatterns(r);
  const requestExtractorIds = (Array.isArray(scanConfig.requestExtractors) && scanConfig.requestExtractors.length)
    ? scanConfig.requestExtractors
    : (scanConfig.requestExtractor ? [scanConfig.requestExtractor] : []);
  const responseExtractorIds = (Array.isArray(scanConfig.responseExtractors) && scanConfig.responseExtractors.length)
    ? scanConfig.responseExtractors
    : (scanConfig.responseExtractor ? [scanConfig.responseExtractor] : []);
  const requestPatterns = [];
  for (let i = 0; i < requestExtractorIds.length; i++) {
    const pattern = resolvePattern(patterns, requestExtractorIds[i], 'request');
    if (pattern) requestPatterns.push(pattern);
  }
  const responsePatterns = [];
  for (let i = 0; i < responseExtractorIds.length; i++) {
    const pattern = resolvePattern(patterns, responseExtractorIds[i], 'response');
    if (pattern) responsePatterns.push(pattern);
  }

  const inspectRequestEnabled = isModeEnabled(inspectMode, 'request');
  const inspectResponseEnabled = isModeEnabled(inspectMode, 'response');
  let redactRequestEnabled = isModeEnabled(redactMode, 'request');
  let redactResponseEnabled = isModeEnabled(redactMode, 'response');
  const extractorParallelEnabled = !!scanConfig.extractorParallelEnabled;
  const wantParallel = requestForwardMode === 'parallel';
  const parallelRequestExtractors = extractorParallelEnabled && requestPatterns.length > 0;
  const parallelResponseExtractors = extractorParallelEnabled && responsePatterns.length > 0;
  let parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled;

  const log = makeLogger({ log: varLevel, r });
  let reqBodyText = '';

  const sideband = {
    url: readVar(r, 'sideband_url',    SIDEBAND_URL_DEFAULT),
    ua: readVar(r, 'sideband_ua',     SIDEBAND_UA_DEFAULT),
    bearer: readVar(r, 'sideband_bearer', SIDEBAND_BEARER_DEFAULT),
    timeout: Number(readVar(r, 'sideband_timeout', SIDEBAND_TIMEOUT_DEFAULT)) || SIDEBAND_TIMEOUT_DEFAULT
  };

  async function processInspectionStage(opts) {
    const {
      phase,
      body,
      fallbackPaths,
      patternsList,
      inspectEnabled,
      redactEnabled,
      parallelExtractors
    } = opts;

    log({ step: 'inspection_stage:start', phase, inspectEnabled, redactEnabled, patterns: patternsList.length }, 'debug');

    if (!inspectEnabled) {
      return { status: 'skipped', body };
    }

    const runParallel = parallelExtractors && patternsList.length > 0;
    const effectiveRedact = runParallel ? false : !!redactEnabled;
    const pathsFallback = (fallbackPaths && fallbackPaths.length) ? fallbackPaths : (phase === 'request' ? REQUEST_PATHS_DEFAULT : RESPONSE_PATHS_DEFAULT);
    let currentBody = body;

    if (runParallel) {
      const results = await Promise.all(patternsList.map((pattern) => runInspectionPhase({
        phase,
        bodyText: currentBody,
        paths: (Array.isArray(pattern.paths) && pattern.paths.length) ? pattern.paths : pathsFallback,
        inspectEnabled: true,
        redactEnabled: false,
        log,
        sideband,
        pattern,
        apiKeys
      })));

      for (let i = 0; i < results.length; i++) {
        logPatternResult(log, phase, {
          patternId: patternsList[i] && patternsList[i].id ? patternsList[i].id : results[i].patternId,
          apiKeyName: results[i].apiKeyName,
          status: results[i].status
        });
      }

      const executed = results.filter((res) => res.status !== 'skipped' && res.status !== 'skipped_no_match');
      const blocked = executed.find((res) => res.status === 'blocked');
      if (blocked) {
        return {
          status: 'blocked',
          outcome: blocked.outcome,
          details: blocked.details,
          apiKeyName: blocked.apiKeyName,
          patternId: blocked.patternId
        };
      }

      if (executed.length === 0) {
        return { status: 'skipped', body: currentBody };
      }

      log({ step: 'inspection_stage:done', phase, status: 'cleared' }, 'debug');
      return { status: 'cleared', body: currentBody };
    }

    let executed = false;
    let redactionApplied = false;
    for (let i = 0; i < patternsList.length; i++) {
      const pattern = patternsList[i];
      const paths = (Array.isArray(pattern.paths) && pattern.paths.length) ? pattern.paths : pathsFallback;
      const result = await runInspectionPhase({
        phase,
        bodyText: currentBody,
        paths,
        inspectEnabled: true,
        redactEnabled: effectiveRedact,
        log,
        sideband,
        pattern,
        apiKeys
      });
      log({ step: 'inspection_stage:pattern_done', phase, pattern_id: pattern.id, status: result.status }, 'debug');
      logPatternResult(log, phase, {
        patternId: pattern.id,
        apiKeyName: result.apiKeyName,
        status: result.status
      });

      if (result.status === 'blocked') {
        return {
          status: 'blocked',
          outcome: result.outcome,
          details: result.details,
          apiKeyName: result.apiKeyName,
          patternId: result.patternId
        };
      }
      if (result.bodyText !== undefined) {
        currentBody = result.bodyText;
      }
      if (result.status !== 'skipped' && result.status !== 'skipped_no_match') {
        executed = true;
        if (result.status === 'redacted') {
          redactionApplied = true;
        }
      }
    }

    if (executed) {
      log({ step: 'inspection_stage:done', phase, status: redactionApplied ? 'redacted' : 'cleared' }, 'debug');
      return {
        status: redactionApplied ? 'redacted' : 'cleared',
        body: currentBody
      };
    }

    log({ step: 'inspection_stage:done', phase, status: 'skipped' }, 'debug');
    return { status: 'skipped', body: currentBody };
  }

  if (wantParallel && inspectRequestEnabled && redactRequestEnabled) {
    log({ step: 'forward_mode:parallel_request_redaction_disabled' }, 'info');
    redactRequestEnabled = false;
  }

  if (parallelRequestExtractors && redactRequestEnabled) {
    log({ step: 'extractors:parallel_request_disables_redaction' }, 'info');
    redactRequestEnabled = false;
  }

  if (parallelResponseExtractors && redactResponseEnabled) {
    log({ step: 'extractors:parallel_response_disables_redaction' }, 'info');
    redactResponseEnabled = false;
  }

  if (responseStreamEnabled && redactResponseEnabled) {
    log({ step: 'stream:redaction_disabled', reason: 'streaming responses are not mutated' }, 'info');
    redactResponseEnabled = false;
  }

  parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled;

  try {
    log(`sideband: ${r.method} ${r.uri} from ${r.remoteAddress}`, 'info');
    log({ step: 'checkpoint', stage: 'start', t: Date.now() }, 'debug');
    log(`headersIn: ${safeJson(r.headersIn)}`, 'debug');
    log(`inspect mode: ${inspectMode}`, 'info');
    log(`redact mode: ${redactMode}`, 'info');
    log(`forward mode: ${requestForwardMode}`, 'info');
    log({ extractor_parallel_enabled: extractorParallelEnabled }, 'info');
    log({
      response_stream_enabled: responseStreamEnabled,
      response_stream_chunk_size: responseStreamChunkSize,
      response_stream_chunk_overlap: responseStreamChunkOverlap,
      response_stream_final_enabled: responseStreamFinalEnabled,
      response_stream_collect_full_enabled: responseStreamCollectFullEnabled
    }, 'info');
    if (wantParallel && !inspectRequestEnabled) {
      log({ step: 'forward_mode:degraded', reason: 'request inspection disabled' }, 'debug');
    }
    if (wantParallel && inspectRequestEnabled && redactRequestEnabled) {
      log({ step: 'forward_mode:degraded', reason: 'request redaction enabled' }, 'info');
    }
    log({
      request_patterns: requestPatterns.map((pattern) => pattern.id),
      response_patterns: responsePatterns.map((pattern) => pattern.id),
      request_fallback_paths: requestFallbackPaths,
      response_fallback_paths: responseFallbackPaths
    }, 'debug');

    const { bodyText } = getRequestBody(r, log);
    reqBodyText = bodyText;

    let backend;
    let backendPromise = null;

    if (parallelForward) {
      log({ step: 'forward_mode:parallel_start' }, 'debug');
      backendPromise = fetchBackend(r, log, reqBodyText, backendOrigin).then(
        (result) => result,
        (error) => {
          log({ step: 'backend:parallel_error', error: String(error) }, 'err');
          throw error;
        }
      );
    }

    const requestResult = await processInspectionStage({
      phase: 'request',
      body: reqBodyText,
      fallbackPaths: requestFallbackPaths,
      patternsList: requestPatterns,
      inspectEnabled: inspectRequestEnabled,
      redactEnabled: redactRequestEnabled,
      parallelExtractors: parallelRequestExtractors
    });

    if (requestResult.status === 'blocked') {
      if (backendPromise) backendPromise.catch(() => {});
      return blockAndReturn(r, log, {
        outcome: requestResult.outcome || 'blocked',
        extra: requestResult.details || {},
        apiKeys,
        apiKeyName: requestResult.apiKeyName,
        patternId: requestResult.patternId,
        phase: 'request'
      });
    }

    if (requestResult.body !== undefined && requestResult.body !== reqBodyText) {
      if (parallelForward) {
        log({ step: 'forward_mode:redaction_ignored', note: 'request already dispatched upstream' }, 'warn');
      }
      reqBodyText = requestResult.body;
    }

    if (parallelForward) {
      backend = await backendPromise;
    } else {
      backend = await fetchBackend(r, log, reqBodyText, backendOrigin);
    }

    const respBodyRaw = (typeof backend.body === 'string')
      ? backend.body
      : (backend.body ? String(backend.body) : '');
    backend.body = respBodyRaw;

    log({ step: 'checkpoint', stage: 'backend_received', bytes: respBodyRaw.length }, 'debug');

    const streamDebug = parseStreamingBody(respBodyRaw, backend.headers, log);
    const streamParsed = responseStreamEnabled
      ? streamDebug
      : { assembled: '', events: 0 };
    log({ step: 'checkpoint', stage: 'stream_parsed', events: streamParsed.events, assembled_chars: streamParsed.assembled.length }, 'debug');
    let respBodyForInspection = respBodyRaw;
    if (responseStreamEnabled && streamParsed.assembled) {
      respBodyForInspection = buildStreamMessageBody(streamParsed.assembled);
    }

    async function inspectStreamChunks(fullText) {
      const chunks = sliceTextChunks(fullText, responseStreamChunkSize, responseStreamChunkOverlap);
      log({ step: 'stream:chunk_plan', chunks: chunks.length, chunk0: chunks[0] ? chunks[0].length : 0 }, 'info');
      if (!chunks.length) {
        return { status: 'skipped' };
      }
      for (let i = 0; i < chunks.length; i++) {
        log({ step: 'stream:chunk_inspect', index: i, size: chunks[i].length }, 'info');
        const chunkResult = await processInspectionStage({
          phase: 'response_stream',
          body: buildStreamMessageBody(chunks[i]),
          fallbackPaths: [],
          patternsList: responsePatterns,
          inspectEnabled: inspectResponseEnabled,
          redactEnabled: false,
          parallelExtractors: false
        });
        if (chunkResult.status === 'blocked') {
          return {
            status: 'blocked',
            outcome: chunkResult.outcome,
            details: {
              ...(chunkResult.details || {}),
              chunk_index: i,
              chunk_size: chunks[i].length
            },
            apiKeyName: chunkResult.apiKeyName,
            patternId: chunkResult.patternId
          };
        }
      }
      return { status: 'cleared' };
    }

    let streamInspectionRan = false;
    if (responseStreamEnabled && streamParsed.assembled && inspectResponseEnabled && responsePatterns.length) {
      streamInspectionRan = true;
      if (responseStreamCollectFullEnabled) {
        log({ step: 'checkpoint', stage: 'stream_full_inspection_start' }, 'debug');
        const fullStreamResult = await processInspectionStage({
          phase: 'response_stream',
          body: buildStreamMessageBody(streamParsed.assembled),
          fallbackPaths: [],
          patternsList: responsePatterns,
          inspectEnabled: inspectResponseEnabled,
          redactEnabled: false,
          parallelExtractors: false
        });
        log({ step: 'checkpoint', stage: 'stream_full_inspection_done', status: fullStreamResult.status }, 'debug');
        if (fullStreamResult.status === 'blocked') {
          return blockAndReturn(r, log, {
            outcome: fullStreamResult.outcome || 'blocked',
            extra: fullStreamResult.details || {},
            apiKeys,
            apiKeyName: fullStreamResult.apiKeyName,
            patternId: fullStreamResult.patternId,
            phase: 'response_stream'
          });
        }
      } else {
        log({ step: 'checkpoint', stage: 'stream_inspection_start' }, 'debug');
        const streamResult = await inspectStreamChunks(streamParsed.assembled);
        log({ step: 'checkpoint', stage: 'stream_inspection_done', status: streamResult.status }, 'debug');
        if (streamResult.status === 'blocked') {
          return blockAndReturn(r, log, {
            outcome: streamResult.outcome || 'blocked',
            extra: streamResult.details || {},
            apiKeys,
            apiKeyName: streamResult.apiKeyName,
            patternId: streamResult.patternId,
            phase: 'response_stream'
          });
        }
      }
    }

    const shouldInspectFinal = !responseStreamEnabled || responseStreamFinalEnabled || (!responseStreamCollectFullEnabled && streamParsed.assembled.length > 0);
    let responseResult = { status: 'skipped', body: respBodyForInspection };
    if (shouldInspectFinal) {
      log({ step: 'checkpoint', stage: 'final_inspection_start', stream_mode: responseStreamEnabled }, 'debug');
      responseResult = await processInspectionStage({
        phase: responseStreamEnabled ? 'response_stream' : 'response',
        body: respBodyForInspection,
        fallbackPaths: responseStreamEnabled ? [] : responseFallbackPaths,
        patternsList: responsePatterns,
        inspectEnabled: inspectResponseEnabled,
        redactEnabled: redactResponseEnabled,
        parallelExtractors: parallelResponseExtractors
      });
      log({ step: 'checkpoint', stage: 'final_inspection_done', status: responseResult.status }, 'debug');
    }

    if (responseResult.status === 'blocked') {
      return blockAndReturn(r, log, {
        outcome: responseResult.outcome || 'blocked',
        extra: responseResult.details || {},
        apiKeys,
        apiKeyName: responseResult.apiKeyName,
        patternId: responseResult.patternId,
        phase: 'response'
      });
    }
    if (responseResult.body !== undefined && !responseStreamEnabled) {
      backend.body = responseResult.body;
    }

    try {
      const result = recordSample(
        r,
        { requestBody: reqBodyText, responseBody: backend.body },
        { log: varLevel, r }
      );
      if (result && result.recorded) {
        log({ step: 'collector:captured', remaining: result.remaining, total: result.total }, 'info');
      }
    } catch (err) {
      log({ step: 'collector:record_failed', error: String(err) }, 'err');
    }

    return sendBackendToClient(r, backend, log);

  } catch (e) {
    ngx.log(ngx.ERR, `sideband error: ${e && e.message ? e.message : e}`);
    // Fail OPEN by default; to fail CLOSED, uncomment:
    // return blockAndReturn(r, makeLogger({ log: 'err', r }), { outcome: 'error', extra: { reason: 'exception in sideband handler' } });
  }

  try {
    const fallbackBody = reqBodyText || r.requestText || '';
    const fallback = await fetchBackend(r, log, fallbackBody, backendOrigin);
    return sendBackendToClient(r, fallback, log);
  } catch (_) {
    r.return(502, 'Upstream error');
  }
}
