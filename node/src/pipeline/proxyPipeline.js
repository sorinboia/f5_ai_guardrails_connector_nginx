import { sanitizeBlockingResponse } from '../utils/helpers.js';
import { ProxyContext, dropPassthroughStream } from './ProxyContext.js';
import {
  parseStreamingBody,
  sliceTextChunks,
  buildStreamMessageBody,
} from './utils.js';
import { processInspectionStage, evaluateMatchers, selectApiKeyForPattern } from './inspectionHelpers.js';
import { recordSample } from './collector.js';
import { buildRequestInit, fetchBuffered, fetchStream, startBuffered, withBody } from './backendClient.js';

function blockingResponseForKey(store, apiKeyName) {
  if (!apiKeyName) return sanitizeBlockingResponse();
  const record = (store.apiKeys || []).find((k) => k.name === apiKeyName);
  if (!record) return sanitizeBlockingResponse();
  return sanitizeBlockingResponse(record.blockingResponse);
}

function buildRequestBody(request) {
  const body = request.body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return '';
}

export class ProxyHandler {
  constructor(fastify) {
    this.fastify = fastify;
  }

  sendBlockingResponse(reply, block) {
    reply.code(block.status || 200).header('content-type', block.contentType || 'application/json; charset=utf-8');
    return reply.send(block.body || '');
  }

  async runRequestInspection(ctx, reqBodyText, request) {
    return processInspectionStage({
      phase: 'request',
      body: reqBodyText,
      fallbackPaths: ctx.requestPaths,
      patternsList: ctx.patterns.request,
      inspectEnabled: ctx.flags.inspectRequestEnabled,
      redactEnabled: ctx.flags.redactRequestEnabled,
      parallelExtractors: ctx.flags.parallelRequestExtractors,
      sideband: ctx.sideband,
      apiKeys: ctx.store.apiKeys,
      log: request.log,
      requestUrl: ctx.backend.requestUrl
    });
  }

  buildLiveInspectChunk(ctx, request) {
    if (!ctx.stream.passthrough || !ctx.flags.inspectResponseEnabled || !ctx.patterns.response.length) {
      return null;
    }
    let lastEvents = 0;
    return async (bodySoFar) => {
      const parsed = parseStreamingBody(bodySoFar);
      if (!parsed.events || parsed.events === lastEvents) return { blocked: false };
      lastEvents = parsed.events;
      const liveResult = await processInspectionStage({
        phase: 'response_stream',
        body: buildStreamMessageBody(parsed.assembled),
        fallbackPaths: [],
        patternsList: ctx.patterns.response,
        inspectEnabled: true,
        redactEnabled: false,
        parallelExtractors: false,
        sideband: ctx.sideband,
        apiKeys: ctx.store.apiKeys,
        log: request.log,
        requestUrl: ctx.backend.requestUrl
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
        patternsList: ctx.patterns.response,
        inspectEnabled: ctx.flags.inspectResponseEnabled,
        redactEnabled: false,
        parallelExtractors: false,
        sideband: ctx.sideband,
        apiKeys: ctx.store.apiKeys,
        log: request.log,
        requestUrl: ctx.backend.requestUrl
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
    if (!ctx.stream.enabled || !streamParsed.assembled || !ctx.flags.inspectResponseEnabled || !ctx.patterns.response.length) {
      return 'skipped';
    }

    if (ctx.stream.collectFull) {
      const fullResult = await processInspectionStage({
        phase: 'response_stream',
        body: buildStreamMessageBody(streamParsed.assembled),
        fallbackPaths: [],
        patternsList: ctx.patterns.response,
        inspectEnabled: ctx.flags.inspectResponseEnabled,
        redactEnabled: false,
        parallelExtractors: false,
        sideband: ctx.sideband,
        apiKeys: ctx.store.apiKeys,
        log: request.log,
        requestUrl: ctx.backend.requestUrl
      });
      if (fullResult.status === 'blocked') {
        if (ctx.stream.blockingAllowed) {
          const block = blockingResponseForKey(ctx.store, fullResult.apiKeyName);
          this.sendBlockingResponse(reply, block);
        } else {
          dropPassthroughStream(ctx, { api_key_name: fullResult.apiKeyName, pattern_id: fullResult.patternId, reason: 'full_stream_blocked' });
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
        dropPassthroughStream(ctx, {
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
      fallbackPaths: ctx.stream.enabled ? [] : ctx.responsePaths,
      patternsList: ctx.patterns.response,
      inspectEnabled: ctx.flags.inspectResponseEnabled,
      redactEnabled: ctx.flags.redactResponseEnabled,
      parallelExtractors: ctx.flags.parallelResponseExtractors,
      sideband: ctx.sideband,
      apiKeys: ctx.store.apiKeys,
      log: request.log,
      requestUrl: ctx.backend.requestUrl
    });

    if (responseResult.status === 'blocked') {
      if (ctx.stream.blockingAllowed) {
        const block = blockingResponseForKey(ctx.store, responseResult.apiKeyName);
        this.sendBlockingResponse(reply, block);
      } else {
        dropPassthroughStream(ctx, { api_key_name: responseResult.apiKeyName, pattern_id: responseResult.patternId, reason: 'final_stream_blocked' });
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
    const ctx = new ProxyContext(this.fastify, request, reply);
    let reqBodyText = buildRequestBody(request);
    const backendInit = buildRequestInit(request, ctx.backend.upstreamHost, ctx.appCfg.caBundle);
    let backendPromise = null;
    let backendAbort = null;

    try {
      if (ctx.flags.parallelForward) {
        const { promise, abort } = startBuffered(
          ctx.backend.upstreamUrl.toString(),
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
        if (ctx.flags.parallelForward) {
          request.log.warn({ step: 'forward_mode:redaction_ignored', note: 'request already dispatched upstream' });
        } else {
          reqBodyText = requestResult.body;
        }
      }

      const liveInspectChunk = this.buildLiveInspectChunk(ctx, request);

      const requestInit = withBody(backendInit, reqBodyText);

      const backend = ctx.stream.passthrough
        ? await fetchStream(
            ctx.backend.upstreamUrl.toString(),
            requestInit,
            reply,
            liveInspectChunk,
            { gateChunks: ctx.stream.gateChunks },
            request.log
          )
        : backendPromise
          ? await backendPromise
          : await fetchBuffered(ctx.backend.upstreamUrl.toString(), requestInit, request.log);

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
          ctx.backend.upstreamUrl.toString(),
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

export {
  evaluateMatchers as _evaluateMatchers,
  selectApiKeyForPattern as _selectApiKeyForPattern
};
