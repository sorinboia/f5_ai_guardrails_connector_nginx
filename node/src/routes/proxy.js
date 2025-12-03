import fp from 'fastify-plugin';
import proxy from '@fastify/http-proxy';
import { createSseChunkTee } from '../pipeline/streaming.js';
import { getHeaderHost } from './helpers.js';
import { resolveConfig } from '../config/validate.js';
import { defaultStore } from '../config/store.js';
import { buildInspectionPreHandler } from '../pipeline/inspection.js';

function resolveBackendContext(fastify, request) {
  const store = fastify.store || defaultStore();
  const host = getHeaderHost(request);
  const config = resolveConfig(store, host);
  const backendOrigin = config.backendOrigin || fastify.appConfig.backendOrigin;

  let upstreamHost = '';
  try {
    upstreamHost = new URL(backendOrigin).host;
  } catch (_) {
    upstreamHost = new URL(fastify.appConfig.backendOrigin).host;
  }

  const ctx = { host, config, backendOrigin, upstreamHost };
  request.sidebandContext = request.sidebandContext || {};
  request.sidebandContext.backend = ctx;
  return ctx;
}

async function proxyRoutes(fastify, opts) {
  const { backendOrigin } = opts;

  function getUpstream(request) {
    const ctx = resolveBackendContext(fastify, request);
    return ctx.backendOrigin;
  }

  function rewriteRequestHeaders(req, headers) {
    const ctx = req.sidebandContext?.backend || resolveBackendContext(fastify, req);
    const next = { ...headers, host: ctx.upstreamHost };
    delete next.connection;
    delete next['proxy-connection'];
    return next;
  }

  // Prototype streaming interception for SSE/text-event responses.
  fastify.addHook('onSend', async (request, reply, payload) => {
    const contentType = (reply.getHeader('content-type') || '').toString().toLowerCase();
    const isStream = payload && typeof payload.pipe === 'function';
    if (!isStream) return payload;
    if (!contentType.includes('text/event-stream')) return payload;

    const tee = createSseChunkTee({
      chunkSize: 2048,
      overlap: 128,
      logger: request.log
    });

    // Avoid stale content-length; streaming size may change.
    reply.removeHeader('content-length');

    // Pipe original payload through tee back to client.
    payload.on('error', (err) => tee.destroy(err));
    tee.on('error', (err) => request.log.warn({ err, step: 'sse_chunk_probe' }, 'Chunk tee error'));
    payload.pipe(tee);
    return tee;
  });

  // Catch-all proxy that mirrors NGINX buffering/host semantics; inspection pipeline will hook in later.
  fastify.register(proxy, {
    upstream: backendOrigin,
    prefix: '/',
    http2: false,
    replyOptions: {
      getUpstream,
      rewriteRequestHeaders
    },
    preHandler: buildInspectionPreHandler(fastify),
    // Undici already streams bodies; keep defaults to avoid buffering/temp files.
  });
}

export default fp(proxyRoutes);
