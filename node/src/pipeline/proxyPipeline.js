import { resolveConfig } from '../config/validate.js';
import { defaultStore } from '../config/store.js';
import { sanitizeBlockingResponse } from '../routes/management.js';
import { getHeaderHost } from '../routes/helpers.js';
import {
  REQUEST_PATHS_DEFAULT,
  RESPONSE_PATHS_DEFAULT,
  isModeEnabled,
  parseStreamingBody,
  sliceTextChunks,
  buildStreamMessageBody,
} from './utils.js';
import { processInspectionStage, evaluateMatchers, selectApiKeyForPattern } from './inspectionHelpers.js';
import { recordSample } from './collector.js';
import { buildRequestInit, fetchBuffered, fetchStream, startBuffered, withBody } from './backendClient.js';
import { buildStreamPlan } from './streamPlan.js';

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

function buildRequestBody(request) {
  const body = request.body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return '';
}

function streamBackendPassthroughLegacy(url, request, bodyText, upstreamHost, caBundle, reply, inspectChunk, options = {}) {
  const init = buildRequestInit(request, upstreamHost, caBundle);
  return fetchStream(
    url,
    withBody(init, bodyText),
    reply,
    inspectChunk,
    options,
    request.log
  );
}

export class ProxyHandler {
  constructor(fastify) {
    this.fastify = fastify;
  }

  buildExtractorConfig(config) {
    const requestExtractorIds = Array.isArray(config.requestExtractors) && config.requestExtractors.length
      ? config.requestExtractors
      : (config.requestExtractor ? [config.requestExtractor] : []);
    const responseExtractorIds = Array.isArray(config.responseExtractors) && config.responseExtractors.length
      ? config.responseExtractors
      : (config.responseExtractor ? [config.responseExtractor] : []);
    return { requestExtractorIds, responseExtractorIds };
  }

  buildSidebandConfig(appCfg, request) {
    return {
      url: appCfg.sidebandUrl,
      bearer: appCfg.sidebandBearer || '',
      ua: appCfg.sidebandUa,
      timeout: appCfg.sidebandTimeoutMs,
      caBundle: appCfg.caBundle,
      testsLocalOverride: appCfg.testsLocalSideband,
      hostHeader: request.headers.host
    };
  }

  dropPassthroughStream(request, reply, meta = {}) {
    request.log.warn({ step: 'stream:passthrough_drop', ...meta });
    if (!reply.raw.destroyed) reply.raw.destroy(new Error('response_stream_blocked'));
  }

  prepareContext(request, reply) {
    const store = this.fastify.store || defaultStore();
    const host = getHeaderHost(request);
    const config = resolveConfig(store, host);
    const appCfg = this.fastify.appConfig;
    const stream = buildStreamPlan(config);
    const { requestExtractorIds, responseExtractorIds } = this.buildExtractorConfig(config);

    const headerInspect = normalizeEnum(request.headers['x-sideband-inspect'], ['off', 'request', 'response', 'both'], config.inspectMode);
    const headerRedact = normalizeEnum(request.headers['x-sideband-redact'], ['off', 'request', 'response', 'both', 'on', 'true'], config.redactMode, { on: 'both', true: 'both' });
    const headerForward = normalizeEnum(request.headers['x-sideband-forward'], ['sequential', 'parallel'], config.requestForwardMode);

    const inspectMode = headerInspect || config.inspectMode;
    const redactMode = headerRedact || config.redactMode;
    const requestForwardMode = headerForward || config.requestForwardMode;

    const requestPatterns = findPatterns(store, requestExtractorIds, 'request');
    const responsePatterns = findPatterns(store, responseExtractorIds, 'response');

    const inspectRequestEnabled = isModeEnabled(inspectMode, 'request');
    const inspectResponseEnabled = isModeEnabled(inspectMode, 'response');
    let redactRequestEnabled = isModeEnabled(redactMode, 'request');
    let redactResponseEnabled = isModeEnabled(redactMode, 'response');

    const extractorParallelEnabled = !!(config.extractorParallelEnabled ?? config.extractorParallel);
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
    if (!stream.redactionAllowed && redactResponseEnabled) {
      request.log.info({ step: 'stream:redaction_disabled', reason: 'streaming responses are not mutated' });
      redactResponseEnabled = false;
    }
    if (!stream.parallelAllowed && wantParallel) {
      request.log.info({ step: 'forward_mode:passthrough_forces_sequential' });
    }

    const parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled && stream.parallelAllowed;

    const upstreamUrl = new URL(request.raw.url || request.url || '/', config.backendOrigin || appCfg.backendOrigin);
    const upstreamHost = upstreamUrl.host;

    return {
      store,
      config,
      appCfg,
      stream,
      headerInspect,
      headerRedact,
      headerForward,
      inspectMode,
      redactMode,
      requestForwardMode,
      requestPatterns,
      responsePatterns,
      inspectRequestEnabled,
      inspectResponseEnabled,
      redactRequestEnabled,
      redactResponseEnabled,
      extractorParallelEnabled,
      parallelRequestExtractors,
      parallelResponseExtractors,
      wantParallel,
      parallelForward,
      upstreamUrl,
      upstreamHost,
      sideband: this.buildSidebandConfig(appCfg, request),
      dropPassthroughStream: (meta) => this.dropPassthroughStream(request, reply, meta)
    };
  }

  sendBlockingResponse(reply, block) {
    reply.code(block.status || 200).header('content-type', block.contentType || 'application/json; charset=utf-8');
    return reply.send(block.body || '');
  }

  async runRequestInspection(ctx, reqBodyText, request) {
    return processInspectionStage({
      phase: 'request',
      body: reqBodyText,
      fallbackPaths: ctx.config.requestPaths || REQUEST_PATHS_DEFAULT,
      patternsList: ctx.requestPatterns,
      inspectEnabled: ctx.inspectRequestEnabled,
      redactEnabled: ctx.redactRequestEnabled,
      parallelExtractors: ctx.parallelRequestExtractors,
      sideband: ctx.sideband,
      apiKeys: ctx.store.apiKeys,
      log: request.log
    });
  }

  buildLiveInspectChunk(ctx, request) {
    if (!ctx.stream.passthrough || !ctx.inspectResponseEnabled || !ctx.responsePatterns.length) return null;
    let lastEvents = 0;
    return async (bodySoFar) => {
      const parsed = parseStreamingBody(bodySoFar);
      if (!parsed.events || parsed.events === lastEvents) return { blocked: false };
      lastEvents = parsed.events;
      const liveResult = await processInspectionStage({
        phase: 'response_stream',
        body: buildStreamMessageBody(parsed.assembled),
        fallbackPaths: [],
        patternsList: ctx.responsePatterns,
        inspectEnabled: true,
        redactEnabled: false,
        parallelExtractors: false,
        sideband: ctx.sideband,
        apiKeys: ctx.store.apiKeys,
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

  async inspectStreamChunks(ctx, request, fullText) {
    const chunks = sliceTextChunks(fullText, ctx.stream.chunkSize, ctx.stream.chunkOverlap);
    if (!chunks.length) return { status: 'skipped' };
    for (let i = 0; i < chunks.length; i++) {
      const chunkResult = await processInspectionStage({
        phase: 'response_stream',
        body: buildStreamMessageBody(chunks[i]),
        fallbackPaths: [],
        patternsList: ctx.responsePatterns,
        inspectEnabled: ctx.inspectResponseEnabled,
        redactEnabled: false,
        parallelExtractors: false,
        sideband: ctx.sideband,
        apiKeys: ctx.store.apiKeys,
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

  async inspectStreamingPhase(ctx, request, reply, streamParsed) {
    if (!ctx.stream.enabled || !streamParsed.assembled || !ctx.inspectResponseEnabled || !ctx.responsePatterns.length) {
      return 'skipped';
    }

    if (ctx.stream.collectFull) {
      const fullResult = await processInspectionStage({
        phase: 'response_stream',
        body: buildStreamMessageBody(streamParsed.assembled),
        fallbackPaths: [],
        patternsList: ctx.responsePatterns,
        inspectEnabled: ctx.inspectResponseEnabled,
        redactEnabled: false,
        parallelExtractors: false,
        sideband: ctx.sideband,
        apiKeys: ctx.store.apiKeys,
        log: request.log
      });
      if (fullResult.status === 'blocked') {
        if (ctx.stream.blockingAllowed) {
          const block = blockingResponseForKey(ctx.store, fullResult.apiKeyName);
          this.sendBlockingResponse(reply, block);
        } else {
          ctx.dropPassthroughStream({ api_key_name: fullResult.apiKeyName, pattern_id: fullResult.patternId, reason: 'full_stream_blocked' });
        }
        return 'blocked';
      }
      return 'cleared';
    }

    const streamResult = await this.inspectStreamChunks(ctx, request, streamParsed.assembled);
    if (streamResult.status === 'blocked') {
      if (ctx.stream.blockingAllowed) {
        const block = blockingResponseForKey(ctx.store, streamResult.apiKeyName);
        this.sendBlockingResponse(reply, block);
      } else {
        ctx.dropPassthroughStream({
          api_key_name: streamResult.apiKeyName,
          pattern_id: streamResult.patternId,
          reason: 'stream_chunk_blocked',
          details: streamResult.details
        });
      }
      return 'blocked';
    }
    return 'cleared';
  }

  async inspectFinalPhase(ctx, request, reply, streamParsed, respBodyForInspection, backend) {
    const shouldInspectFinal = !ctx.stream.enabled || ctx.stream.finalEnabled || (!ctx.stream.collectFull && streamParsed.assembled.length > 0);
    if (!shouldInspectFinal) return 'skipped';

    const responseResult = await processInspectionStage({
      phase: ctx.stream.enabled ? 'response_stream' : 'response',
      body: respBodyForInspection,
      fallbackPaths: ctx.stream.enabled ? [] : (ctx.config.responsePaths || RESPONSE_PATHS_DEFAULT),
      patternsList: ctx.responsePatterns,
      inspectEnabled: ctx.inspectResponseEnabled,
      redactEnabled: ctx.redactResponseEnabled,
      parallelExtractors: ctx.parallelResponseExtractors,
      sideband: ctx.sideband,
      apiKeys: ctx.store.apiKeys,
      log: request.log
    });

    if (responseResult.status === 'blocked') {
      if (ctx.stream.blockingAllowed) {
        const block = blockingResponseForKey(ctx.store, responseResult.apiKeyName);
        this.sendBlockingResponse(reply, block);
      } else {
        ctx.dropPassthroughStream({ api_key_name: responseResult.apiKeyName, pattern_id: responseResult.patternId, reason: 'final_stream_blocked' });
      }
      return 'blocked';
    }
    if (responseResult.body !== undefined && !ctx.stream.enabled) {
      backend.body = responseResult.body;
    }
    return 'cleared';
  }

  applyResponseHeaders(reply, backend) {
    for (const [key, value] of Object.entries(backend.headers || {})) {
      if (['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
      reply.header(key, value);
    }
  }

  recordSampleIfNeeded(ctx, request, reqBodyText, backendBody) {
    const sample = recordSample(ctx.store, { requestBody: reqBodyText, responseBody: backendBody });
    if (sample.recorded) {
      request.log.info({ step: 'collector:captured', remaining: sample.remaining, total: sample.total });
      this.fastify.saveStore(ctx.store);
    }
  }

  async handle(request, reply) {
    const ctx = this.prepareContext(request, reply);
    let reqBodyText = buildRequestBody(request);
    const backendInit = buildRequestInit(request, ctx.upstreamHost, ctx.appCfg.caBundle);
    let backendPromise = null;
    let backendAbort = null;

    try {
      if (ctx.parallelForward) {
        const { promise, abort } = startBuffered(
          ctx.upstreamUrl.toString(),
          withBody(backendInit, reqBodyText),
          request.log
        );
        backendPromise = promise;
        backendAbort = abort;
      }

      const requestResult = await this.runRequestInspection(ctx, reqBodyText, request);
      if (requestResult.status === 'blocked') {
        if (backendAbort) backendAbort();
        const block = blockingResponseForKey(ctx.store, requestResult.apiKeyName);
        return this.sendBlockingResponse(reply, block);
      }

      if (requestResult.body !== undefined && requestResult.body !== reqBodyText) {
        if (ctx.parallelForward) {
          request.log.warn({ step: 'forward_mode:redaction_ignored', note: 'request already dispatched upstream' });
        } else {
          reqBodyText = requestResult.body;
        }
      }

      const liveInspectChunk = this.buildLiveInspectChunk(ctx, request);

      const requestInit = withBody(backendInit, reqBodyText);

      const backend = ctx.stream.passthrough
        ? await fetchStream(
            ctx.upstreamUrl.toString(),
            requestInit,
            reply,
            liveInspectChunk,
            { gateChunks: ctx.stream.gateChunks },
            request.log
          )
        : backendPromise
          ? await backendPromise
          : await fetchBuffered(ctx.upstreamUrl.toString(), requestInit, request.log);

      const respBodyRaw = typeof backend.body === 'string' ? backend.body : (backend.body ? String(backend.body) : '');
      backend.body = respBodyRaw;

      const streamParsed = ctx.stream.enabled ? parseStreamingBody(respBodyRaw, backend.headers) : { assembled: '', events: 0 };
      const respBodyForInspection = (ctx.stream.enabled && streamParsed.assembled)
        ? buildStreamMessageBody(streamParsed.assembled)
        : respBodyRaw;

      const streamPhase = await this.inspectStreamingPhase(ctx, request, reply, streamParsed);
      if (streamPhase === 'blocked') return;

      const finalPhase = await this.inspectFinalPhase(ctx, request, reply, streamParsed, respBodyForInspection, backend);
      if (finalPhase === 'blocked') return;

      this.recordSampleIfNeeded(ctx, request, reqBodyText, backend.body);

      if (!ctx.stream.passthrough) {
        this.applyResponseHeaders(reply, backend);
        reply.code(backend.status);
        reply.header('content-length', Buffer.byteLength(backend.body || '', 'utf8'));
        return reply.send(backend.body || '');
      }
      return;
    } catch (err) {
      request.log.error({ step: 'proxy:error', error: err?.message || String(err) });
      try {
        const fallback = await fetchBuffered(
          ctx.upstreamUrl.toString(),
          withBody(backendInit, reqBodyText),
          request.log
        );
        this.applyResponseHeaders(reply, fallback);
        reply.code(fallback.status);
        reply.header('content-length', Buffer.byteLength(fallback.body || '', 'utf8'));
        return reply.send(fallback.body || '');
      } catch (fallbackErr) {
        request.log.error({ step: 'proxy:fallback_error', error: fallbackErr?.message || String(fallbackErr) });
        return reply.code(502).send('Upstream error');
      }
    }
  }
}

export function buildProxyHandler(fastify) {
  const handler = new ProxyHandler(fastify);
  return handler.handle.bind(handler);
}

// Expose matcher helpers for targeted unit tests without altering runtime API surface.
export {
  evaluateMatchers as _evaluateMatchers,
  selectApiKeyForPattern as _selectApiKeyForPattern,
  streamBackendPassthroughLegacy as _streamBackendPassthrough
};
