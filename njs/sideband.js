export default { handle };

import { extractJoin, makeLogger, safeJson } from './utils.js';

/* ----------------------------- Configuration ------------------------------ */

// Static defaults (can be overridden via nginx variables)
const SIDEBAND_URL_DEFAULT    = 'https://www.us1.calypsoai.app/backend/v1/scans';
const SIDEBAND_UA_DEFAULT     = 'njs-sideband/1.0';
const SIDEBAND_BEARER_DEFAULT =
  'MDE5OThmNmEtMTE5ZS03MDdkLTg5OTktMTU0NDgzYzNiNDA4/FsEqxzRtAxO6oXwyEKEwI9GGf5qjGJu7owwKjUNXRkUVkkoxFbeXJpedcHZY9YsQC9aNOSj75dTOhKJA';

// Selectors used when extracting content for scanning
const REQUEST_PATHS  = ['.messages[-1].content'];
// Adjust as needed for your backend responses
const RESPONSE_PATHS = ['.message.content'];

// Logging default; override with $sideband_log
const DEFAULT_LOG_LEVEL = 'debug';

// Inspecting default; override with $sideband_inspect
// Allowed: 'request' | 'response' | 'both' | 'off'
const DEFAULT_INSPECT_MODE = 'both';

/* --------------------------- Small helper utils --------------------------- */

function readVar(r, name, fallback) {
  try {
    const v = r && r.variables && r.variables[name];
    return (v === undefined || v === null || v === '') ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return undefined; }
}

function isOn(mode, target) {
  if (!mode) return false;
  if (mode === 'off') return false;
  if (mode === 'both') return true;
  return mode === target;
}

/* --------------------------- Response helpers ----------------------------- */

function buildBlockedBody() {
  return {
    message: {
      role: "assistant",
      content: "F5 AI Guardrails blocked this request"
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

function extractFromJSON(text, paths, log, label) {
  const parsed = safeJsonParse(text);
  if (!parsed) {
    log(`${label}: not valid JSON; extracted empty string`, 'warn');
    return '';
  }
  const joined = extractJoin(parsed, paths, ' ', { log, r: undefined });
  log({ step: `${label}:extracted`, preview: joined.slice(0, 200) }, 'debug');
  return joined;
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

async function callSideband(log, url, bearer, ua, payloadStr) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': ua,
    'authorization': `Bearer ${bearer}`
  };

  log({ step: 'sideband:request', url, headers: { ...headers, authorization: '[redacted]' } }, 'debug');

  const reply  = await ngx.fetch(url, { method: 'POST', headers, body: payloadStr });
  const status = reply.status;
  let text     = '';
  try { text = await reply.text(); } catch (_) { /* ignore */ }

  log({ step: 'sideband:response', status, preview: text.slice(0, 200) }, 'debug');
  return { status, text };
}

function parseSidebandOutcome(sbStatus, sbText) {
  const sbJson  = safeJsonParse(sbText) || {};
  const outcome = (((sbJson || {}).result) || {}).outcome;
  return { outcome, sbJson };
}

function shouldBlock(outcome) {
  return outcome !== 'cleared';
}

// Recreate the original request and send it to @backend as a subrequest.
// Captures status, headers, and body so we can decide whether to pass/deny.
async function fetchBackend(r, log, bodyText) {
  const args = r.variables && r.variables.args ? r.variables.args : '';
  const opt  = { method: r.method, body: bodyText, args };
  log({ step: 'backend:subrequest', method: opt.method, args: args || '' }, 'debug');

  const resp = await r.subrequest('/backend/', opt);

  // In njs, subrequest reply typically has: status, headersOut, responseBody/responseText
  const status  = resp.status;
  const headers = resp.headersOut || {};
  // Prefer responseBody (Buffer-like string) then responseText
  const body    = (resp.responseBody !== undefined) ? resp.responseBody
                : (resp.responseText !== undefined ? resp.responseText : '');

  log({ step: 'backend:response', status, hdrs_sample: Object.keys(headers).slice(0, 6) }, 'debug');
  return { status, headers, body };
}

// Relay backend response to client (after we decide it's allowed).
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
  const varLevel       = readVar(r, 'sideband_log', DEFAULT_LOG_LEVEL);
  const inspectModeVar = readVar(r, 'sideband_inspect', DEFAULT_INSPECT_MODE);
  const inspectMode    = String(inspectModeVar).toLowerCase();

  const log = makeLogger({ log: varLevel, r });

  try {
    // Config (allow per-env overrides via nginx vars)
    const SIDEBAND_URL    = readVar(r, 'sideband_url',    SIDEBAND_URL_DEFAULT);
    const SIDEBAND_UA     = readVar(r, 'sideband_ua',     SIDEBAND_UA_DEFAULT);
    const SIDEBAND_BEARER = readVar(r, 'sideband_bearer', SIDEBAND_BEARER_DEFAULT);

    log(`sideband: ${r.method} ${r.uri} from ${r.remoteAddress}`, 'info');
    log(`headersIn: ${safeJson(r.headersIn)}`, 'debug');
    log(`inspect mode: ${inspectMode}`, 'info');

    // 1) Get request body (always, since we need it to recreate the request)
    const { bodyText: reqBodyText } = getRequestBody(r, log);

    // 2) If enabled, **immediately** scan ONLY the request extract
    if (isOn(inspectMode, 'request')) {
      const requestExtract = extractFromJSON(reqBodyText, REQUEST_PATHS, log, 'request');
      const requestPayload = buildSidebandPayload(requestExtract); // no extra labels/text
      const { status: sbStatusReq, text: sbTextReq } =
        await callSideband(log, SIDEBAND_URL, SIDEBAND_BEARER, SIDEBAND_UA, requestPayload);

      const { outcome: outcomeReq } = parseSidebandOutcome(sbStatusReq, sbTextReq);
      log(`sideband (request) outcome=${String(outcomeReq)} status=${sbStatusReq}`, 'info');

      if (shouldBlock(outcomeReq)) {
        const details = {
          sideband_status: sbStatusReq,
          sideband_preview: (sbTextReq || '').substring(0, 512)
        };
        return blockAndReturn(r, log, outcomeReq || 'unknown', details);
      }
    }

    // 3) Send to backend as a subrequest (recreate original request)
    const backend = await fetchBackend(r, log, reqBodyText);
    const respBodyText = (typeof backend.body === 'string')
      ? backend.body
      : (backend.body ? String(backend.body) : '');

    // 4) If enabled, scan ONLY the response extract (no request included)
    if (isOn(inspectMode, 'response')) {
      const responseExtract = extractFromJSON(respBodyText, RESPONSE_PATHS, log, 'response');
      const responsePayload = buildSidebandPayload(responseExtract); // no extra labels/text
      const { status: sbStatusResp, text: sbTextResp } =
        await callSideband(log, SIDEBAND_URL, SIDEBAND_BEARER, SIDEBAND_UA, responsePayload);

      const { outcome: outcomeResp } = parseSidebandOutcome(sbStatusResp, sbTextResp);
      log(`sideband (response) outcome=${String(outcomeResp)} status=${sbStatusResp}`, 'info');

      if (shouldBlock(outcomeResp)) {
        const details = {
          sideband_status: sbStatusResp,
          sideband_preview: (sbTextResp || '').substring(0, 512)
        };
        return blockAndReturn(r, log, outcomeResp || 'unknown', details);
      }
    }

    // 5) Cleared (or inspection off): relay backend response
    return sendBackendToClient(r, backend, log);

  } catch (e) {
    ngx.log(ngx.ERR, `sideband error: ${e && e.message ? e.message : e}`);
    // Fail OPEN by default; to fail CLOSED, uncomment:
    // return blockAndReturn(r, makeLogger({log: 'err', r}), 'error', { reason: 'exception in sideband handler' });
  }

  // Fallback: try to proxy anyway
  try {
    const fallback = await fetchBackend(r, log, (r.requestText || ''));
    return sendBackendToClient(r, fallback, log);
  } catch (_) {
    r.return(502, 'Upstream error');
  }
}
