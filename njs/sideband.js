export default { handle };

import { isModeEnabled, makeLogger, readScanConfig, readVar, safeJson, safeJsonParse } from './utils.js';
import { callSideband } from './sideband_client.js';
import { applyRedactions, collectRedactionPlan, extractContextPayload } from './redaction.js';
import { recordSample } from './collector_store.js';

/* ----------------------------- Configuration ------------------------------ */

const SIDEBAND_URL_DEFAULT    = 'https://www.us1.calypsoai.app/backend/v1/scans';
const SIDEBAND_UA_DEFAULT     = 'njs-sideband/1.0';
const SIDEBAND_BEARER_DEFAULT =
  'MDE5OThmNmEtMTE5ZS03MDdkLTg5OTktMTU0NDgzYzNiNDA4/FsEqxzRtAxO6oXwyEKEwI9GGf5qjGJu7owwKjUNXRkUVkkoxFbeXJpedcHZY9YsQC9aNOSj75dTOhKJA';

const REQUEST_PATHS_DEFAULT  = ['.messages[-1].content'];
const RESPONSE_PATHS_DEFAULT = ['.message.content'];

const DEFAULT_LOG_LEVEL   = 'info';
const DEFAULT_INSPECT_MODE = 'both';
const DEFAULT_REDACT_MODE  = 'on';

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
    sideband
  } = opts;

  if (!inspectEnabled) {
    return { status: 'skipped', bodyText };
  }

  const context = extractContextPayload(bodyText, paths, log, phase);
  const payload = buildSidebandPayload(context.extracted);
  const { status: sbStatus, text: sbText } =
    await callSideband(log, sideband.url, sideband.bearer, sideband.ua, payload);

  const { outcome, sbJson } = parseSidebandOutcome(sbStatus, sbText);
  const normalizedOutcome = normalizeOutcome(outcome);

  if (normalizedOutcome === 'flagged') {
    return {
      status: 'blocked',
      outcome: normalizedOutcome,
      details: {
        sideband_status: sbStatus,
        sideband_preview: (sbText || '').substring(0, 512),
        reason: `${phase} outcome flagged`
      }
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
          reason: `${phase} redaction disabled`
        }
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
          unmatched_matches: redaction.unmatched
        }
      };
    }

    return {
      status: 'redacted',
      outcome: normalizedOutcome,
      bodyText: redaction.text !== undefined ? redaction.text : bodyText
    };
  }

  if (normalizedOutcome && normalizedOutcome !== 'cleared') {
    return {
      status: 'blocked',
      outcome: normalizedOutcome,
      details: {
        sideband_status: sbStatus,
        sideband_preview: (sbText || '').substring(0, 512),
        reason: `unexpected ${phase} outcome: ${normalizedOutcome}`
      }
    };
  }

  return { status: 'cleared', outcome: normalizedOutcome, bodyText };
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
  const requestPaths   = (keyvalConfig.requestPaths && keyvalConfig.requestPaths.length)
    ? keyvalConfig.requestPaths
    : REQUEST_PATHS_DEFAULT;
  const responsePaths  = (keyvalConfig.responsePaths && keyvalConfig.responsePaths.length)
    ? keyvalConfig.responsePaths
    : RESPONSE_PATHS_DEFAULT;

  const log = makeLogger({ log: varLevel, r });
  let reqBodyText = '';

  const sideband = {
    url: readVar(r, 'sideband_url',    SIDEBAND_URL_DEFAULT),
    ua: readVar(r, 'sideband_ua',     SIDEBAND_UA_DEFAULT),
    bearer: readVar(r, 'sideband_bearer', SIDEBAND_BEARER_DEFAULT)
  };

  const inspectRequestEnabled = isModeEnabled(inspectMode, 'request');
  const inspectResponseEnabled = isModeEnabled(inspectMode, 'response');
  const redactRequestEnabled = isModeEnabled(redactMode, 'request');
  const redactResponseEnabled = isModeEnabled(redactMode, 'response');

  try {
    log(`sideband: ${r.method} ${r.uri} from ${r.remoteAddress}`, 'info');
    log(`headersIn: ${safeJson(r.headersIn)}`, 'debug');
    log(`inspect mode: ${inspectMode}`, 'info');
    log(`redact mode: ${redactMode}`, 'info');
    log({ request_paths: requestPaths, response_paths: responsePaths }, 'debug');

    const { bodyText } = getRequestBody(r, log);
    reqBodyText = bodyText;

    const requestInspection = await runInspectionPhase({
      phase: 'request',
      bodyText: reqBodyText,
      paths: requestPaths,
      inspectEnabled: inspectRequestEnabled,
      redactEnabled: redactRequestEnabled,
      log,
      sideband
    });

    if (requestInspection.status === 'blocked') {
      return blockAndReturn(r, log, requestInspection.outcome, requestInspection.details);
    }
    if (requestInspection.bodyText !== undefined) {
      reqBodyText = requestInspection.bodyText;
    }

    const backend = await fetchBackend(r, log, reqBodyText);
    let respBodyText = (typeof backend.body === 'string')
      ? backend.body
      : (backend.body ? String(backend.body) : '');
    backend.body = respBodyText;

    const responseInspection = await runInspectionPhase({
      phase: 'response',
      bodyText: respBodyText,
      paths: responsePaths,
      inspectEnabled: inspectResponseEnabled,
      redactEnabled: redactResponseEnabled,
      log,
      sideband
    });

    if (responseInspection.status === 'blocked') {
      return blockAndReturn(r, log, responseInspection.outcome, responseInspection.details);
    }
    if (responseInspection.bodyText !== undefined) {
      respBodyText = responseInspection.bodyText;
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
