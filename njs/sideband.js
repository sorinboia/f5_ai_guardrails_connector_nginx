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
  if (expectedContext && record.context && record.context !== expectedContext) {
    return undefined;
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

function buildBlockedBody() {
  return {
    message: {
      role: 'assistant',
      content: 'F5 AI Guardrails blocked this request'
    }
  };
}

function blockAndReturn(r, log, outcome, extra) {
  const bodyObj = buildBlockedBody();
  const body = JSON.stringify(bodyObj);

  r.headersOut['content-type'] = 'application/json; charset=utf-8';
  log({ step: 'block', outcome, extraPreview: extra ? String(extra).slice(0, 200) : undefined }, 'info');
  r.return(200, body);
}

/* --------------------------- Pipeline helpers ----------------------------- */

function getRequestBody(r, log) {
  let bodyBuf = r.requestBuffer;
  let bodyText;

  if (bodyBuf === undefined) {
    bodyText = r.requestText || '';
    bodyBuf  = Buffer.from(bodyText);
  } else {
    bodyText = bodyBuf.toString('utf8');
  }

  log(`body length=${bodyBuf.length || 0}B`, 'debug');
  log({ bodyPreview: bodyText.slice(0, 512) }, 'debug');
  return { bodyBuf, bodyText };
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
  const { status: sbStatus, text: sbText } =
    await callSideband(log, sideband.url, keyDecision.bearer, sideband.ua, payload);

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

async function fetchBackend(r, log, bodyText) {
  const args = r.variables && r.variables.args ? r.variables.args : '';
  const opt  = { method: r.method, body: bodyText, args };
  log({ step: 'backend:subrequest', method: opt.method, args: args || '' }, 'debug');

  const resp = await r.subrequest('/backend/', opt);

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
  const keyvalConfig   = readScanConfig(r);
  const configLogLevel = keyvalConfig.logLevel || DEFAULT_LOG_LEVEL;
  const varLevel       = readVar(r, 'sideband_log', configLogLevel);
  const inspectBase    = keyvalConfig.inspectMode || DEFAULT_INSPECT_MODE;
  const inspectModeVar = readVar(r, 'sideband_inspect', inspectBase);
  const inspectMode    = String(inspectModeVar).toLowerCase();
  const redactBase     = keyvalConfig.redactMode || DEFAULT_REDACT_MODE;
  const redactModeVar  = readVar(r, 'sideband_redact', redactBase);
  const redactMode     = String(redactModeVar).toLowerCase();
  const requestFallbackPaths = (keyvalConfig.requestPaths && keyvalConfig.requestPaths.length)
    ? keyvalConfig.requestPaths
    : REQUEST_PATHS_DEFAULT;
  const responseFallbackPaths = (keyvalConfig.responsePaths && keyvalConfig.responsePaths.length)
    ? keyvalConfig.responsePaths
    : RESPONSE_PATHS_DEFAULT;
  const forwardBase    = keyvalConfig.requestForwardMode || DEFAULT_FORWARD_MODE;
  const forwardModeVar = readVar(r, 'sideband_request_forward', forwardBase);
  const requestForwardMode = String(forwardModeVar).toLowerCase();

  const apiKeys = readApiKeys(r);
  const patterns = readPatterns(r);
  const requestExtractorIds = (Array.isArray(keyvalConfig.requestExtractors) && keyvalConfig.requestExtractors.length)
    ? keyvalConfig.requestExtractors
    : (keyvalConfig.requestExtractor ? [keyvalConfig.requestExtractor] : []);
  const responseExtractorIds = (Array.isArray(keyvalConfig.responseExtractors) && keyvalConfig.responseExtractors.length)
    ? keyvalConfig.responseExtractors
    : (keyvalConfig.responseExtractor ? [keyvalConfig.responseExtractor] : []);
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
  const extractorParallelEnabled = !!keyvalConfig.extractorParallelEnabled;
  const wantParallel = requestForwardMode === 'parallel';
  let parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled;

  const log = makeLogger({ log: varLevel, r });
  let reqBodyText = '';

  const sideband = {
    url: readVar(r, 'sideband_url',    SIDEBAND_URL_DEFAULT),
    ua: readVar(r, 'sideband_ua',     SIDEBAND_UA_DEFAULT),
    bearer: readVar(r, 'sideband_bearer', SIDEBAND_BEARER_DEFAULT)
  };

  async function processInspectionStage(opts) {
    const {
      phase,
      body,
      fallbackPaths,
      patternsList,
      inspectEnabled,
      redactEnabled
    } = opts;

    if (!inspectEnabled) {
      return { status: 'skipped', body };
    }

    const effectiveRedact = extractorParallelEnabled ? false : !!redactEnabled;
    const pathsFallback = (fallbackPaths && fallbackPaths.length) ? fallbackPaths : (phase === 'request' ? REQUEST_PATHS_DEFAULT : RESPONSE_PATHS_DEFAULT);
    let currentBody = body;

    if (extractorParallelEnabled && patternsList.length) {
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
        return { status: 'blocked', outcome: blocked.outcome, details: blocked.details };
      }

      if (executed.length === 0) {
        const fallbackResult = await runInspectionPhase({
          phase,
          bodyText: currentBody,
          paths: pathsFallback,
          inspectEnabled: true,
          redactEnabled: false,
          log,
          sideband,
          pattern: undefined,
          apiKeys
        });
        if (fallbackResult.status === 'blocked') {
          return { status: 'blocked', outcome: fallbackResult.outcome, details: fallbackResult.details };
        }
        return {
          status: fallbackResult.status,
          body: fallbackResult.bodyText !== undefined ? fallbackResult.bodyText : currentBody
        };
      }

      return { status: 'cleared', body: currentBody };
    }

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
      logPatternResult(log, phase, {
        patternId: pattern.id,
        apiKeyName: result.apiKeyName,
        status: result.status
      });

      if (result.status === 'blocked') {
        return { status: 'blocked', outcome: result.outcome, details: result.details };
      }
      if (result.bodyText !== undefined) {
        currentBody = result.bodyText;
      }
      if (result.status !== 'skipped' && result.status !== 'skipped_no_match') {
        return { status: result.status, body: currentBody };
      }
    }

    const fallbackResult = await runInspectionPhase({
      phase,
      bodyText: currentBody,
      paths: pathsFallback,
      inspectEnabled: true,
      redactEnabled: effectiveRedact,
      log,
      sideband,
      pattern: undefined,
      apiKeys
    });

    if (fallbackResult.status === 'blocked') {
      return { status: 'blocked', outcome: fallbackResult.outcome, details: fallbackResult.details };
    }
    if (fallbackResult.bodyText !== undefined) {
      currentBody = fallbackResult.bodyText;
    }
    return { status: fallbackResult.status, body: currentBody };
  }

  if (extractorParallelEnabled) {
    if (redactRequestEnabled || redactResponseEnabled) {
      log({ step: 'extractors:parallel_mode_disables_redaction' }, 'info');
    }
    redactRequestEnabled = false;
    redactResponseEnabled = false;
    parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled;
  }

  try {
    log(`sideband: ${r.method} ${r.uri} from ${r.remoteAddress}`, 'info');
    log(`headersIn: ${safeJson(r.headersIn)}`, 'debug');
    log(`inspect mode: ${inspectMode}`, 'info');
    log(`redact mode: ${redactMode}`, 'info');
    log(`forward mode: ${requestForwardMode}`, 'info');
    log({ extractor_parallel_enabled: extractorParallelEnabled }, 'info');
    if (wantParallel && !inspectRequestEnabled) {
      log({ step: 'forward_mode:degraded', reason: 'request inspection disabled' }, 'debug');
    }
    if (wantParallel && redactRequestEnabled) {
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
      backendPromise = fetchBackend(r, log, reqBodyText).then(
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
      redactEnabled: redactRequestEnabled
    });

    if (requestResult.status === 'blocked') {
      if (backendPromise) backendPromise.catch(() => {});
      return blockAndReturn(r, log, requestResult.outcome || 'blocked', requestResult.details || {});
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
      backend = await fetchBackend(r, log, reqBodyText);
    }

    let respBodyText = (typeof backend.body === 'string')
      ? backend.body
      : (backend.body ? String(backend.body) : '');
    backend.body = respBodyText;

    const responseResult = await processInspectionStage({
      phase: 'response',
      body: respBodyText,
      fallbackPaths: responseFallbackPaths,
      patternsList: responsePatterns,
      inspectEnabled: inspectResponseEnabled,
      redactEnabled: redactResponseEnabled
    });

    if (responseResult.status === 'blocked') {
      return blockAndReturn(r, log, responseResult.outcome || 'blocked', responseResult.details || {});
    }
    if (responseResult.body !== undefined) {
      respBodyText = responseResult.body;
      backend.body = respBodyText;
    }

    try {
      const result = recordSample(
        r,
        { requestBody: reqBodyText, responseBody: respBodyText },
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
    // return blockAndReturn(r, makeLogger({log: 'err', r}), 'error', { reason: 'exception in sideband handler' });
  }

  try {
    const fallbackBody = reqBodyText || r.requestText || '';
    const fallback = await fetchBackend(r, log, fallbackBody);
    return sendBackendToClient(r, fallback, log);
  } catch (_) {
    r.return(502, 'Upstream error');
  }
}
