import fs from 'fs';
import { PassThrough, Readable } from 'stream';
import { once } from 'events';
import { finished } from 'stream/promises';
import undici from 'undici';
import { resolveConfig } from '../config/validate.js';
import { defaultStore } from '../config/store.js';
import { sanitizeBlockingResponse } from '../routes/management.js';
import { getHeaderHost } from '../routes/helpers.js';
import {
  REQUEST_PATHS_DEFAULT,
  RESPONSE_PATHS_DEFAULT,
  STREAM_CHUNK_SIZE_DEFAULT,
  STREAM_CHUNK_OVERLAP_DEFAULT,
  isModeEnabled,
  parseStreamingBody,
  sliceTextChunks,
  buildStreamMessageBody,
  safeJsonParse,
  getPathAccessor,
} from './utils.js';
import { collectRedactionPlan, applyRedactions, extractContextPayload } from './redaction.js';
import { callSideband } from './sidebandClient.js';
import { recordSample } from './collector.js';

const { request: undiciRequest, Agent } = undici;
const backendAgentCache = new Map();

function getBackendDispatcher(caBundle, logger) {
  if (!caBundle) return undefined;
  if (backendAgentCache.has(caBundle)) return backendAgentCache.get(caBundle);
  try {
    const ca = fs.readFileSync(caBundle, 'utf8');
    const agent = new Agent({ connect: { ca } });
    backendAgentCache.set(caBundle, agent);
    return agent;
  } catch (err) {
    logger?.warn({ step: 'backend:ca_load_failed', caBundle, error: err?.message || String(err) });
    return undefined;
  }
}

function normalizeEnum(value, allowed, fallback, aliases = {}) {
  if (value === undefined || value === null) return fallback;
  const str = String(value).toLowerCase();
  if (aliases[str]) return aliases[str];
  if (allowed.includes(str)) return str;
  return fallback;
}

function blockingResponseForKey(store, apiKeyName) {
  if (!apiKeyName) return sanitizeBlockingResponse();
  const record = (store.apiKeys || []).find((k) => k.name === apiKeyName);
  if (!record) return sanitizeBlockingResponse();
  return sanitizeBlockingResponse(record.blockingResponse);
}

function evaluateMatchers(parsed, matchers = []) {
  if (!matchers.length) return { matched: true };
  if (!parsed) return { matched: false, reason: 'no_json' };

  for (let i = 0; i < matchers.length; i++) {
    const m = matchers[i];
    if (!m || typeof m.path !== 'string') return { matched: false, reason: 'invalid_matcher', index: i };
    const accessor = getPathAccessor(parsed, m.path);
    const value = accessor ? accessor.value : undefined;
    const exists = accessor !== undefined;
    if (m.exists === true && !exists) return { matched: false, reason: 'exists_false', path: m.path };
    if (m.equals !== undefined && value !== m.equals) return { matched: false, reason: 'equals_mismatch', path: m.path };
    if (m.contains !== undefined) {
      const str = value === undefined || value === null ? '' : String(value);
      if (!str.includes(m.contains)) return { matched: false, reason: 'contains_mismatch', path: m.path };
    }
  }
  return { matched: true };
}

function selectApiKeyForPattern(context, pattern, apiKeys, defaultBearer, logger, phase) {
  if (!pattern) return { bearer: defaultBearer, matched: true, shouldRun: true };
  const parsed = context?.parsed;
  if (Array.isArray(pattern.matchers) && pattern.matchers.length) {
    if (!parsed) {
      logger.debug({ step: `${phase}:pattern_no_json`, pattern_id: pattern.id });
      return { bearer: defaultBearer, matched: false, shouldRun: false, apiKeyName: pattern.apiKeyName, patternId: pattern.id };
    }
    const evaluation = evaluateMatchers(parsed, pattern.matchers);
    if (!evaluation.matched) {
      logger.debug({ step: `${phase}:pattern_miss`, pattern_id: pattern.id, reason: evaluation.reason, path: evaluation.path || null });
      return { bearer: defaultBearer, matched: false, shouldRun: false, apiKeyName: pattern.apiKeyName, patternId: pattern.id };
    }
  } else {
    logger.debug({ step: `${phase}:pattern_no_matchers`, pattern_id: pattern.id });
  }

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

function findPatterns(store, ids = [], context) {
  const list = Array.isArray(ids) ? ids : [];
  return list
    .map((id) => (store.patterns || []).find((p) => p.id === id && (
      p.context === context ||
      (context === 'response' && p.context === 'response_stream') ||
      (context === 'response_stream' && (p.context === 'response' || p.context === 'response_stream'))
    )))
    .filter(Boolean);
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
    return { status: 'skipped', bodyText, apiKeyName: undefined, patternId: pattern?.id };
  }

  const context = extractContextPayload(bodyText, paths, log, phase);
  const keyDecision = selectApiKeyForPattern(context, pattern, apiKeys, sideband.bearer, log, phase);
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
    return {
      status: 'blocked',
      outcome: normalizedOutcome,
      details: { sideband_status: status },
      apiKeyName: keyDecision.apiKeyName,
      patternId: pattern?.id
    };
  }

  if (normalizedOutcome === 'redacted') {
    if (!redactEnabled) {
      return {
        status: 'blocked',
        outcome: normalizedOutcome,
        details: { sideband_status: status, reason: `${phase} redaction disabled` },
        apiKeyName: keyDecision.apiKeyName,
        patternId: pattern?.id
      };
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
      return {
        status: 'blocked',
        outcome: normalizedOutcome,
        details: { sideband_status: status, failed_scanners: plan.failedCount, unsupported_scanners: plan.unsupported },
        apiKeyName: keyDecision.apiKeyName,
        patternId: pattern?.id
      };
    }
    return {
      status: 'redacted',
      outcome: normalizedOutcome,
      bodyText: redaction.text ?? bodyText,
      apiKeyName: keyDecision.apiKeyName,
      patternId: pattern?.id
    };
  }

  if (normalizedOutcome && normalizedOutcome !== 'cleared') {
    return {
      status: 'blocked',
      outcome: normalizedOutcome,
      details: { sideband_status: status, reason: `unexpected ${phase} outcome` },
      apiKeyName: keyDecision.apiKeyName,
      patternId: pattern?.id
    };
  }

  return {
    status: 'cleared',
    outcome: normalizedOutcome,
    bodyText,
    apiKeyName: keyDecision.apiKeyName,
    patternId: pattern?.id
  };
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
    log
  } = opts;

  if (!inspectEnabled) return { status: 'skipped', body };
  const runParallel = parallelExtractors && patternsList.length > 0;
  const effectiveRedact = runParallel ? false : !!redactEnabled;
  const pathsFallback = (fallbackPaths && fallbackPaths.length) ? fallbackPaths : (phase === 'request' ? REQUEST_PATHS_DEFAULT : RESPONSE_PATHS_DEFAULT);

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
      apiKeys
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
      apiKeys
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

function buildRequestBody(request) {
  const body = request.body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return '';
}

function filterRequestHeaders(headers, upstreamHost) {
  const next = { ...headers };
  delete next.connection;
  delete next['proxy-connection'];
  delete next['content-length'];
  delete next['transfer-encoding'];
  next.host = upstreamHost;
  next['accept-encoding'] = 'identity';
  return next;
}

function cloneHeaders(headers) {
  const obj = {};
  if (!headers) return obj;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'transfer-encoding') continue;
    obj[key] = value;
  }
  return obj;
}

async function fetchBackend(url, request, bodyText, upstreamHost, caBundle) {
  const headers = filterRequestHeaders(request.headers, upstreamHost);
  const method = request.method || 'GET';
  const dispatcher = getBackendDispatcher(caBundle, request.log);
  const res = await undiciRequest(url, {
    method,
    headers,
    body: bodyText && ['GET', 'HEAD'].includes(method) ? undefined : bodyText,
    dispatcher
  });
  const response = res;
  let responseBody = '';
  for await (const chunk of response.body) {
    responseBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
  }
  return {
    status: response.statusCode,
    headers: cloneHeaders(response.headers),
    body: responseBody
  };
}

async function streamBackendPassthrough(url, request, bodyText, upstreamHost, caBundle, reply, inspectChunk, options = {}) {
  const gateChunks = !!options.gateChunks && typeof inspectChunk === 'function';
  const headers = filterRequestHeaders(request.headers, upstreamHost);
  const method = request.method || 'GET';
  const dispatcher = getBackendDispatcher(caBundle, request.log);
  const res = await undiciRequest(url, {
    method,
    headers,
    body: bodyText && ['GET', 'HEAD'].includes(method) ? undefined : bodyText,
    dispatcher
  });

  const responseHeaders = cloneHeaders(res.headers);
  for (const [key, value] of Object.entries(responseHeaders || {})) {
    if (['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
    reply.header(key, value);
  }
  reply.code(res.statusCode);

  const source = Readable.from(res.body);
  const tee = new PassThrough();
  let responseBody = '';
  let blocked = false;
  let inspecting = false;

  const destroyStreams = (err) => {
    const reason = err || new Error('response_stream_blocked');
    if (!reply.raw.destroyed) reply.raw.destroy(reason);
    source.destroy(reason);
    tee.destroy(reason);
  };

  source.on('error', (err) => {
    request.log.error({ step: 'stream:upstream_error', error: err?.message || String(err) });
    tee.destroy(err);
  });
  tee.on('error', (err) => {
    request.log.error({ step: 'stream:passthrough_error', error: err?.message || String(err) });
    reply.raw.destroy(err);
  });

  if (gateChunks) {
    reply.send(tee);
    try {
      for await (const chunk of source) {
        const chunkBuf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        const chunkText = chunkBuf.toString('utf8');
        responseBody += chunkText;

        if (inspectChunk && !blocked && !inspecting) {
          inspecting = true;
          try {
            const result = await inspectChunk(responseBody);
            inspecting = false;
            if (result?.blocked && !blocked) {
              blocked = true;
              request.log.warn({ step: 'stream:passthrough_drop', reason: 'live_chunk_blocked', api_key_name: result.apiKeyName, pattern_id: result.patternId, details: result.details || {} });
              destroyStreams(new Error('response_stream_blocked'));
              break;
            }
          } catch (err) {
            inspecting = false;
            request.log.error({ step: 'stream:inspect_error', error: err?.message || String(err) });
          }
        }

        if (blocked) break;

        if (!tee.destroyed) {
          const wrote = tee.write(chunkBuf);
          if (!wrote) await once(tee, 'drain');
        }
      }
    } catch (err) {
      request.log.error({ step: 'stream:passthrough_finish_error', error: err?.message || String(err) });
    } finally {
      if (!blocked && !tee.destroyed) tee.end();
    }
    try {
      await finished(tee);
    } catch (err) {
      request.log.error({ step: 'stream:passthrough_finish_error', error: err?.message || String(err) });
    }
  } else {
    tee.on('data', (chunk) => {
      responseBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      if (inspectChunk && !blocked && !inspecting) {
        inspecting = true;
        inspectChunk(responseBody)
          .then((result) => {
            inspecting = false;
            if (result?.blocked && !blocked) {
              blocked = true;
              request.log.warn({ step: 'stream:passthrough_drop', reason: 'live_chunk_blocked', api_key_name: result.apiKeyName, pattern_id: result.patternId, details: result.details || {} });
              destroyStreams(new Error('response_stream_blocked'));
            }
          })
          .catch((err) => {
            inspecting = false;
            request.log.error({ step: 'stream:inspect_error', error: err?.message || String(err) });
          });
      }
    });

    source.pipe(tee);
    reply.send(tee);

    try {
      await finished(tee);
    } catch (err) {
      request.log.error({ step: 'stream:passthrough_finish_error', error: err?.message || String(err) });
    }
  }

  return {
    status: res.statusCode,
    headers: responseHeaders,
    body: responseBody,
    streamed: true
  };
}

function startBackendRequest(url, request, bodyText, upstreamHost, caBundle) {
  const controller = new AbortController();
  const headers = filterRequestHeaders(request.headers, upstreamHost);
  const method = request.method || 'GET';
  const dispatcher = getBackendDispatcher(caBundle, request.log);
  const promise = undiciRequest(url, {
    method,
    headers,
    body: bodyText && ['GET', 'HEAD'].includes(method) ? undefined : bodyText,
    signal: controller.signal,
    dispatcher
  }).then(async (res) => {
    let responseBody = '';
    for await (const chunk of res.body) {
      responseBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    }
    return {
      status: res.statusCode,
      headers: cloneHeaders(res.headers),
      body: responseBody
    };
  });
  return { promise, abort: () => controller.abort() };
}

export function buildProxyHandler(fastify) {
  return async function proxyHandler(request, reply) {
    const store = fastify.store || defaultStore();
    const host = getHeaderHost(request);
    const config = resolveConfig(store, host);
    const appCfg = fastify.appConfig;

    const headerInspect = normalizeEnum(request.headers['x-sideband-inspect'], ['off', 'request', 'response', 'both'], config.inspectMode);
    const headerRedact = normalizeEnum(request.headers['x-sideband-redact'], ['off', 'request', 'response', 'both', 'on', 'true'], config.redactMode, { on: 'both', true: 'both' });
    const headerForward = normalizeEnum(request.headers['x-sideband-forward'], ['sequential', 'parallel'], config.requestForwardMode);

    const inspectMode = headerInspect || config.inspectMode;
    const redactMode = headerRedact || config.redactMode;
    const requestForwardMode = headerForward || config.requestForwardMode;

    const responseStreamEnabled = config.responseStreamEnabled !== undefined ? !!config.responseStreamEnabled : true;
    const responseStreamChunkSize = Math.min(
      Math.max(config.responseStreamChunkSize || STREAM_CHUNK_SIZE_DEFAULT, 128),
      65536
    );
    let responseStreamChunkOverlap = config.responseStreamChunkOverlap ?? STREAM_CHUNK_OVERLAP_DEFAULT;
    if (responseStreamChunkOverlap < 0) responseStreamChunkOverlap = 0;
    if (responseStreamChunkOverlap >= responseStreamChunkSize) {
      responseStreamChunkOverlap = responseStreamChunkSize > 1 ? responseStreamChunkSize - 1 : 0;
    }
    const responseStreamFinalEnabled = config.responseStreamFinalEnabled !== undefined ? !!config.responseStreamFinalEnabled : true;
    const responseStreamCollectFullEnabled = !!config.responseStreamCollectFullEnabled;
    const responseStreamBufferingMode = normalizeEnum(
      config.responseStreamBufferingMode,
      ['buffer', 'passthrough'],
      'buffer',
      { passthru: 'passthrough' }
    );
    const responseStreamPassthrough = responseStreamEnabled && responseStreamBufferingMode === 'passthrough';
    const responseStreamBlockingAllowed = !responseStreamPassthrough;
    const responseStreamChunkGatingEnabled = !!config.responseStreamChunkGatingEnabled;

    const dropPassthroughStream = (meta = {}) => {
      // Socket-level drop to enforce blocks when we've already streamed bytes to the client.
      request.log.warn({ step: 'stream:passthrough_drop', ...meta });
      if (!reply.raw.destroyed) reply.raw.destroy(new Error('response_stream_blocked'));
    };

    const extractorParallelEnabled = !!(config.extractorParallelEnabled ?? config.extractorParallel);

    const requestExtractorIds = Array.isArray(config.requestExtractors) && config.requestExtractors.length
      ? config.requestExtractors
      : (config.requestExtractor ? [config.requestExtractor] : []);
    const responseExtractorIds = Array.isArray(config.responseExtractors) && config.responseExtractors.length
      ? config.responseExtractors
      : (config.responseExtractor ? [config.responseExtractor] : []);

    const requestPatterns = findPatterns(store, requestExtractorIds, 'request');
    const responsePatterns = findPatterns(store, responseExtractorIds, 'response');

    const inspectRequestEnabled = isModeEnabled(inspectMode, 'request');
    const inspectResponseEnabled = isModeEnabled(inspectMode, 'response');
    let redactRequestEnabled = isModeEnabled(redactMode, 'request');
    let redactResponseEnabled = isModeEnabled(redactMode, 'response');

    const wantParallel = requestForwardMode === 'parallel';
    const parallelRequestExtractors = extractorParallelEnabled && requestPatterns.length > 0;
    const parallelResponseExtractors = extractorParallelEnabled && responsePatterns.length > 0;

    if (wantParallel && inspectRequestEnabled && redactRequestEnabled) {
      request.log.info({ step: 'forward_mode:parallel_request_redaction_disabled' });
      redactRequestEnabled = false;
    }
    if (parallelRequestExtractors && redactRequestEnabled) {
      request.log.info({ step: 'extractors:parallel_request_disables_redaction' });
      redactRequestEnabled = false;
    }
    if (parallelResponseExtractors && redactResponseEnabled) {
      request.log.info({ step: 'extractors:parallel_response_disables_redaction' });
      redactResponseEnabled = false;
    }
    if (responseStreamEnabled && redactResponseEnabled) {
      request.log.info({ step: 'stream:redaction_disabled', reason: 'streaming responses are not mutated' });
      redactResponseEnabled = false;
    }

    if (responseStreamPassthrough && wantParallel) {
      request.log.info({ step: 'forward_mode:passthrough_forces_sequential' });
    }

    const parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled && !responseStreamPassthrough;

    const upstreamUrl = new URL(request.raw.url || request.url || '/', config.backendOrigin || appCfg.backendOrigin);
    const upstreamHost = upstreamUrl.host;

    const sideband = {
      url: appCfg.sidebandUrl,
      bearer: appCfg.sidebandBearer || '',
      ua: appCfg.sidebandUa,
      timeout: appCfg.sidebandTimeoutMs,
      caBundle: appCfg.caBundle,
      testsLocalOverride: appCfg.testsLocalSideband,
      hostHeader: request.headers.host
    };

    let reqBodyText = buildRequestBody(request);
    let backendPromise = null;
    let backendAbort = null;

    try {
      if (parallelForward) {
        const { promise, abort } = startBackendRequest(
          upstreamUrl.toString(),
          request,
          reqBodyText,
          upstreamHost,
          appCfg.caBundle
        );
        backendPromise = promise;
        backendAbort = abort;
      }

      const requestResult = await processInspectionStage({
        phase: 'request',
        body: reqBodyText,
        fallbackPaths: config.requestPaths || REQUEST_PATHS_DEFAULT,
        patternsList: requestPatterns,
        inspectEnabled: inspectRequestEnabled,
        redactEnabled: redactRequestEnabled,
        parallelExtractors: parallelRequestExtractors,
        sideband,
        apiKeys: store.apiKeys,
        log: request.log
      });

      if (requestResult.status === 'blocked') {
        if (backendAbort) backendAbort();
        const block = blockingResponseForKey(store, requestResult.apiKeyName);
        reply.code(block.status || 200).header('content-type', block.contentType || 'application/json; charset=utf-8');
        return reply.send(block.body || '');
      }

      if (requestResult.body !== undefined && requestResult.body !== reqBodyText) {
        if (parallelForward) {
          request.log.warn({ step: 'forward_mode:redaction_ignored', note: 'request already dispatched upstream' });
        } else {
          reqBodyText = requestResult.body;
        }
      }

      let liveInspectChunk = null;
      if (responseStreamPassthrough && inspectResponseEnabled && responsePatterns.length) {
        let lastEvents = 0;
        liveInspectChunk = async (bodySoFar) => {
          const parsed = parseStreamingBody(bodySoFar);
          if (!parsed.events || parsed.events === lastEvents) return { blocked: false };
          lastEvents = parsed.events;
          const liveResult = await processInspectionStage({
            phase: 'response_stream',
            body: buildStreamMessageBody(parsed.assembled),
            fallbackPaths: [],
            patternsList: responsePatterns,
            inspectEnabled: true,
            redactEnabled: false,
            parallelExtractors: false,
            sideband,
            apiKeys: store.apiKeys,
            log: request.log
          });
          if (liveResult.status === 'blocked') {
            return {
              blocked: true,
              apiKeyName: liveResult.apiKeyName,
              patternId: liveResult.patternId,
              details: liveResult.details
            };
          }
          return { blocked: false };
        };
      }

      const backend = responseStreamPassthrough
        ? await streamBackendPassthrough(
            upstreamUrl.toString(),
            request,
            reqBodyText,
            upstreamHost,
            appCfg.caBundle,
            reply,
            liveInspectChunk,
            { gateChunks: responseStreamChunkGatingEnabled }
          )
        : backendPromise
          ? await backendPromise
          : await fetchBackend(upstreamUrl.toString(), request, reqBodyText, upstreamHost, appCfg.caBundle);

      const respBodyRaw = typeof backend.body === 'string' ? backend.body : (backend.body ? String(backend.body) : '');
      backend.body = respBodyRaw;

      const streamParsed = responseStreamEnabled ? parseStreamingBody(respBodyRaw, backend.headers) : { assembled: '', events: 0 };
      let respBodyForInspection = respBodyRaw;
      if (responseStreamEnabled && streamParsed.assembled) {
        respBodyForInspection = buildStreamMessageBody(streamParsed.assembled);
      }

      async function inspectStreamChunks(fullText) {
        const chunks = sliceTextChunks(fullText, responseStreamChunkSize, responseStreamChunkOverlap);
        if (!chunks.length) return { status: 'skipped' };
        for (let i = 0; i < chunks.length; i++) {
          const chunkResult = await processInspectionStage({
            phase: 'response_stream',
            body: buildStreamMessageBody(chunks[i]),
            fallbackPaths: [],
            patternsList: responsePatterns,
            inspectEnabled: inspectResponseEnabled,
            redactEnabled: false,
            parallelExtractors: false,
            sideband,
            apiKeys: store.apiKeys,
            log: request.log
          });
          if (chunkResult.status === 'blocked') {
            return {
              status: 'blocked',
              outcome: chunkResult.outcome,
              details: { ...(chunkResult.details || {}), chunk_index: i, chunk_size: chunks[i].length },
              apiKeyName: chunkResult.apiKeyName,
              patternId: chunkResult.patternId
            };
          }
        }
        return { status: 'cleared' };
      }

      if (responseStreamEnabled && streamParsed.assembled && inspectResponseEnabled && responsePatterns.length) {
        if (responseStreamCollectFullEnabled) {
          const fullResult = await processInspectionStage({
            phase: 'response_stream',
            body: buildStreamMessageBody(streamParsed.assembled),
            fallbackPaths: [],
            patternsList: responsePatterns,
            inspectEnabled: inspectResponseEnabled,
            redactEnabled: false,
            parallelExtractors: false,
            sideband,
            apiKeys: store.apiKeys,
            log: request.log
          });
          if (fullResult.status === 'blocked') {
            if (responseStreamBlockingAllowed) {
              const block = blockingResponseForKey(store, fullResult.apiKeyName);
              reply.code(block.status || 200).header('content-type', block.contentType || 'application/json; charset=utf-8');
              return reply.send(block.body || '');
            }
            dropPassthroughStream({ api_key_name: fullResult.apiKeyName, pattern_id: fullResult.patternId, reason: 'full_stream_blocked' });
            return;
          }
        } else {
          const streamResult = await inspectStreamChunks(streamParsed.assembled);
          if (streamResult.status === 'blocked') {
            if (responseStreamBlockingAllowed) {
              const block = blockingResponseForKey(store, streamResult.apiKeyName);
              reply.code(block.status || 200).header('content-type', block.contentType || 'application/json; charset=utf-8');
              return reply.send(block.body || '');
            }
            dropPassthroughStream({ api_key_name: streamResult.apiKeyName, pattern_id: streamResult.patternId, reason: 'stream_chunk_blocked', details: streamResult.details });
            return;
          }
        }
      }

      const shouldInspectFinal = !responseStreamEnabled || responseStreamFinalEnabled || (!responseStreamCollectFullEnabled && streamParsed.assembled.length > 0);
      if (shouldInspectFinal) {
        const responseResult = await processInspectionStage({
          phase: responseStreamEnabled ? 'response_stream' : 'response',
          body: respBodyForInspection,
          fallbackPaths: responseStreamEnabled ? [] : (config.responsePaths || RESPONSE_PATHS_DEFAULT),
          patternsList: responsePatterns,
          inspectEnabled: inspectResponseEnabled,
          redactEnabled: redactResponseEnabled,
          parallelExtractors: parallelResponseExtractors,
          sideband,
          apiKeys: store.apiKeys,
          log: request.log
        });

        if (responseResult.status === 'blocked') {
          if (responseStreamBlockingAllowed) {
            const block = blockingResponseForKey(store, responseResult.apiKeyName);
            reply.code(block.status || 200).header('content-type', block.contentType || 'application/json; charset=utf-8');
            return reply.send(block.body || '');
          }
          dropPassthroughStream({ api_key_name: responseResult.apiKeyName, pattern_id: responseResult.patternId, reason: 'final_stream_blocked' });
          return;
        }
        if (responseResult.body !== undefined && !responseStreamEnabled) {
          backend.body = responseResult.body;
        }
      }

      const sample = recordSample(store, { requestBody: reqBodyText, responseBody: backend.body });
      if (sample.recorded) {
        request.log.info({ step: 'collector:captured', remaining: sample.remaining, total: sample.total });
        fastify.saveStore(store);
      }

      if (!responseStreamPassthrough) {
        for (const [key, value] of Object.entries(backend.headers || {})) {
          if (['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
          reply.header(key, value);
        }
        reply.code(backend.status);
        reply.header('content-length', Buffer.byteLength(backend.body || '', 'utf8'));
        return reply.send(backend.body || '');
      }
      return; // response already streamed to client
    } catch (err) {
      request.log.error({ step: 'proxy:error', error: err?.message || String(err) });
      // Fail open: try to proxy raw request without inspection
      try {
        const fallback = await fetchBackend(upstreamUrl.toString(), request, reqBodyText, upstreamHost, appCfg.caBundle);
        for (const [key, value] of Object.entries(fallback.headers || {})) {
          if (['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
          reply.header(key, value);
        }
        reply.code(fallback.status);
        reply.header('content-length', Buffer.byteLength(fallback.body || '', 'utf8'));
        return reply.send(fallback.body || '');
      } catch (fallbackErr) {
        request.log.error({ step: 'proxy:fallback_error', error: fallbackErr?.message || String(fallbackErr) });
        return reply.code(502).send('Upstream error');
      }
    }
  };
}

// Expose matcher helpers for targeted unit tests without altering runtime API surface.
export {
  evaluateMatchers as _evaluateMatchers,
  selectApiKeyForPattern as _selectApiKeyForPattern,
  streamBackendPassthrough as _streamBackendPassthrough
};
