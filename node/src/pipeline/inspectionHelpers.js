import {
  REQUEST_PATHS_DEFAULT,
  RESPONSE_PATHS_DEFAULT,
  getPathAccessor
} from './utils.js';
import { safeJsonParse } from './safeJson.js';
import { collectRedactionPlan, applyRedactions, extractContextPayload } from './redaction.js';
import { callSideband } from './sidebandClient.js';
import { EXTRACT_PREVIEW_LIMIT } from '../config/constants.js';

function evaluateUrlMatcher(urlRegex, requestUrl) {
  if (!urlRegex || (typeof urlRegex === 'string' && !urlRegex.trim())) {
    return { matched: false, reason: 'no_url_regex_configured' };
  }
  if (!requestUrl) return { matched: false, reason: 'no_url' };
  try {
    const regex = new RegExp(urlRegex);
    if (!regex.test(requestUrl)) {
      return { matched: false, reason: 'url_regex_mismatch', urlRegex, requestUrl };
    }
    return { matched: true };
  } catch (e) {
    return { matched: false, reason: 'invalid_url_regex', urlRegex, error: e.message };
  }
}

function evaluateMatchers(parsed, matchers = [], options = {}) {
  const { urlRegex, requestUrl } = options;

  const urlResult = evaluateUrlMatcher(urlRegex, requestUrl);
  if (!urlResult.matched) return urlResult;

  if (!matchers.length) return { matched: true };
  if (!parsed) return { matched: false, reason: 'no_json' };

  const normalizeComparator = (val) => {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'string' && val.trim() === '') return undefined;
    return val;
  };

  for (let i = 0; i < matchers.length; i++) {
    const m = matchers[i];
    if (!m || typeof m.path !== 'string') return { matched: false, reason: 'invalid_matcher', index: i };
    const accessor = getPathAccessor(parsed, m.path);
    const value = accessor ? accessor.value : undefined;
    const exists = accessor !== undefined;

    const equals = normalizeComparator(m.equals);
    const contains = normalizeComparator(m.contains);

    if (m.exists === true && !exists) return { matched: false, reason: 'exists_false', path: m.path };
    if (equals !== undefined && value !== equals) return { matched: false, reason: 'equals_mismatch', path: m.path };
    if (contains !== undefined) {
      const str = value === undefined || value === null ? '' : String(value);
      if (!str.includes(contains)) return { matched: false, reason: 'contains_mismatch', path: m.path };
    }
  }
  return { matched: true };
}

function selectApiKeyForPattern(context, pattern, apiKeys, defaultBearer, logger, phase, requestUrl) {
  if (!pattern) return { bearer: defaultBearer, matched: true, shouldRun: true };
  const parsed = context?.parsed;
  const hasMatchers = Array.isArray(pattern.matchers) && pattern.matchers.length;
  const hasUrlRegex = pattern.urlRegex && typeof pattern.urlRegex === 'string' && pattern.urlRegex.trim();

  if (hasMatchers && !parsed) {
    logger.debug({ step: `${phase}:pattern_no_json`, pattern_id: pattern.id });
    return { bearer: defaultBearer, matched: false, shouldRun: false, apiKeyName: pattern.apiKeyName, patternId: pattern.id };
  }

  const evaluation = evaluateMatchers(parsed, hasMatchers ? pattern.matchers : [], {
    urlRegex: hasUrlRegex ? pattern.urlRegex : null,
    requestUrl
  });
  if (!evaluation.matched) {
    logger.debug({
      step: `${phase}:pattern_miss`,
      pattern_id: pattern.id,
      reason: evaluation.reason,
      path: evaluation.path || null,
      urlRegex: evaluation.urlRegex || null,
      requestUrl: evaluation.requestUrl || null
    });
    return { bearer: defaultBearer, matched: false, shouldRun: false, apiKeyName: pattern.apiKeyName, patternId: pattern.id };
  }

  const extractedText = typeof context?.extracted === 'string' ? context.extracted : '';
  const truncated = extractedText.length > EXTRACT_PREVIEW_LIMIT;
  logger?.debug?.({
    step: `${phase}:pattern_match_extracted`,
    pattern_id: pattern.id,
    api_key_name: pattern.apiKeyName || null,
    extracted: truncated ? `${extractedText.slice(0, EXTRACT_PREVIEW_LIMIT)}...` : extractedText,
    extracted_length: extractedText.length,
    extracted_truncated: truncated
  });

  const record = (apiKeys || []).find((k) => k.name === pattern.apiKeyName);
  if (!record || !record.key) {
    logger.warn({ step: `${phase}:pattern_key_missing`, pattern_id: pattern.id, api_key_name: pattern.apiKeyName });
    return { bearer: defaultBearer, matched: true, shouldRun: true, apiKeyName: pattern.apiKeyName, patternId: pattern.id };
  }

  logger.info({ step: `${phase}:pattern_match`, pattern_id: pattern.id, api_key_name: record.name });
  return { bearer: record.key, matched: true, shouldRun: true, apiKeyName: record.name, patternId: pattern.id };
}

function buildSidebandPayload(text) {
  return JSON.stringify({
    input: text,
    configOverrides: {},
    forceEnabled: [],
    disabled: [],
    verbose: false
  });
}

function parseOutcome(status, text) {
  const json = safeJsonParse(text) || {};
  const outcome = (json?.result?.outcome ? String(json.result.outcome) : '').toLowerCase();
  return { outcome, json, status, text };
}

// Unified inspection result builder
function buildInspectionResult(status, outcome, opts = {}) {
  return {
    status,
    outcome,
    details: opts.details,
    bodyText: opts.bodyText,
    apiKeyName: opts.apiKeyName,
    patternId: opts.patternId
  };
}

function handleFlaggedOutcome(phase, keyDecision, pattern, status) {
  return buildInspectionResult('blocked', 'flagged', {
    details: { sideband_status: status },
    apiKeyName: keyDecision.apiKeyName,
    patternId: pattern?.id
  });
}

function handleRedactedOutcome(opts) {
  const { phase, redactEnabled, json, context, log, keyDecision, pattern, sidebandStatus, bodyText } = opts;

  if (!redactEnabled) {
    return buildInspectionResult('blocked', 'redacted', {
      details: { sideband_status: sidebandStatus, reason: `${phase} redaction disabled` },
      apiKeyName: keyDecision.apiKeyName,
      patternId: pattern?.id
    });
  }

  const plan = collectRedactionPlan(json);
  let redaction = { applied: plan.matches.length === 0, unmatched: 0, text: undefined };

  if (plan.matches.length) {
    redaction = applyRedactions(context, plan.matches, log, phase);
  } else {
    log.info({ step: `${phase}:redaction_skipped`, reason: 'no regex matches returned' });
  }

  const redactionOk = redaction.applied && redaction.unmatched === 0 && plan.unsupported.length === 0;
  if (!redactionOk) {
    return buildInspectionResult('blocked', 'redacted', {
      details: { sideband_status: sidebandStatus, failed_scanners: plan.failedCount, unsupported_scanners: plan.unsupported },
      apiKeyName: keyDecision.apiKeyName,
      patternId: pattern?.id
    });
  }

  return buildInspectionResult('redacted', 'redacted', {
    bodyText: redaction.text ?? bodyText,
    apiKeyName: keyDecision.apiKeyName,
    patternId: pattern?.id
  });
}

function handleUnexpectedOutcome(phase, outcome, keyDecision, pattern, status) {
  return buildInspectionResult('blocked', outcome, {
    details: { sideband_status: status, reason: `unexpected ${phase} outcome` },
    apiKeyName: keyDecision.apiKeyName,
    patternId: pattern?.id
  });
}

function handleClearedOutcome(outcome, keyDecision, pattern, bodyText) {
  return buildInspectionResult('cleared', outcome, {
    bodyText,
    apiKeyName: keyDecision.apiKeyName,
    patternId: pattern?.id
  });
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
    apiKeys,
    requestUrl
  } = opts;

  if (!inspectEnabled) {
    return { status: 'skipped', bodyText, apiKeyName: undefined, patternId: pattern?.id };
  }

  const context = extractContextPayload(bodyText, paths, log, phase);
  const keyDecision = selectApiKeyForPattern(context, pattern, apiKeys, sideband.bearer, log, phase, requestUrl);

  if (keyDecision.shouldRun === false) {
    return {
      status: 'skipped_no_match',
      bodyText,
      apiKeyName: keyDecision.apiKeyName,
      patternId: pattern?.id
    };
  }

  const payload = buildSidebandPayload(context.extracted);
  const { status, text } = await callSideband({
    url: sideband.url,
    bearer: keyDecision.bearer,
    payload,
    timeoutMs: sideband.timeout,
    caBundle: sideband.caBundle,
    testsLocalOverride: sideband.testsLocalOverride,
    hostHeader: sideband.hostHeader,
    logger: log,
    ua: sideband.ua
  });

  const { outcome, json } = parseOutcome(status, text);
  const normalizedOutcome = outcome || '';

  if (normalizedOutcome === 'flagged') {
    return handleFlaggedOutcome(phase, keyDecision, pattern, status);
  }

  if (normalizedOutcome === 'redacted') {
    return handleRedactedOutcome({
      phase,
      redactEnabled,
      json,
      context,
      log,
      keyDecision,
      pattern,
      sidebandStatus: status,
      bodyText
    });
  }

  if (normalizedOutcome && normalizedOutcome !== 'cleared') {
    return handleUnexpectedOutcome(phase, normalizedOutcome, keyDecision, pattern, status);
  }

  return handleClearedOutcome(normalizedOutcome, keyDecision, pattern, bodyText);
}

async function processInspectionStage(opts) {
  const {
    phase,
    body,
    fallbackPaths,
    patternsList,
    inspectEnabled,
    redactEnabled,
    parallelExtractors,
    sideband,
    apiKeys,
    log,
    requestUrl
  } = opts;

  if (!inspectEnabled) return { status: 'skipped', body };

  const runParallel = parallelExtractors && patternsList.length > 0;
  const effectiveRedact = runParallel ? false : !!redactEnabled;
  const pathsFallback = (fallbackPaths && fallbackPaths.length)
    ? fallbackPaths
    : (phase === 'request' ? REQUEST_PATHS_DEFAULT : RESPONSE_PATHS_DEFAULT);

  if (runParallel) {
    const results = await Promise.all(patternsList.map((pattern) => runInspectionPhase({
      phase,
      bodyText: body,
      paths: (Array.isArray(pattern.paths) && pattern.paths.length) ? pattern.paths : pathsFallback,
      inspectEnabled: true,
      redactEnabled: false,
      log,
      sideband,
      pattern,
      apiKeys,
      requestUrl
    })));

    const executed = results.filter((r) => r.status !== 'skipped' && r.status !== 'skipped_no_match');
    const blocked = executed.find((r) => r.status === 'blocked');
    if (blocked) return blocked;
    if (!executed.length) return { status: 'skipped', body };
    return { status: 'cleared', body };
  }

  let currentBody = body;
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
      apiKeys,
      requestUrl
    });

    if (result.status === 'blocked') return result;
    if (result.bodyText !== undefined) currentBody = result.bodyText;
    if (result.status !== 'skipped' && result.status !== 'skipped_no_match') {
      executed = true;
      if (result.status === 'redacted') redactionApplied = true;
    }
  }

  if (!executed) return { status: 'skipped', body };
  return { status: redactionApplied ? 'redacted' : 'cleared', body: currentBody };
}

export {
  evaluateMatchers,
  selectApiKeyForPattern,
  buildSidebandPayload,
  parseOutcome,
  runInspectionPhase,
  processInspectionStage
};
