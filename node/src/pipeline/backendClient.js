import { PassThrough, Readable } from 'stream';
import { once } from 'events';
import { finished } from 'stream/promises';
import undici from 'undici';
import { getDispatcher } from './dispatcher.js';

const { request: undiciRequest } = undici;

export function filterRequestHeaders(headers = {}, upstreamHost) {
  const next = { ...headers };
  delete next.connection;
  delete next['proxy-connection'];
  delete next['content-length'];
  delete next['transfer-encoding'];
  next.host = upstreamHost;
  next['accept-encoding'] = 'identity';
  return next;
}

export function cloneHeaders(headers = {}) {
  const obj = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'transfer-encoding') continue;
    obj[key] = value;
  }
  return obj;
}

export function buildRequestInit(request, upstreamHost, caBundle) {
  const headers = filterRequestHeaders(request.headers, upstreamHost);
  const method = request.method || 'GET';
  return {
    method,
    headers,
    dispatcher: getDispatcher(caBundle, request.log)
  };
}

export function withBody(init, bodyText) {
  const method = init.method || 'GET';
  const body = bodyText && ['GET', 'HEAD'].includes(method) ? undefined : bodyText;
  return { ...init, body };
}

export async function fetchBuffered(url, init, logger) {
  const res = await undiciRequest(url, init);
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

export async function fetchStream(url, init, reply, inspectChunk, options = {}, logger) {
  const gateChunks = !!options.gateChunks && typeof inspectChunk === 'function';
  const res = await undiciRequest(url, init);

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
    logger?.error?.({ step: 'stream:upstream_error', error: err?.message || String(err) });
    tee.destroy(err);
  });
  tee.on('error', (err) => {
    logger?.error?.({ step: 'stream:passthrough_error', error: err?.message || String(err) });
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
              logger?.warn?.({ step: 'stream:passthrough_drop', reason: 'live_chunk_blocked', api_key_name: result.apiKeyName, pattern_id: result.patternId, details: result.details || {} });
              destroyStreams(new Error('response_stream_blocked'));
              break;
            }
          } catch (err) {
            inspecting = false;
            logger?.error?.({ step: 'stream:inspect_error', error: err?.message || String(err) });
          }
        }

        if (blocked) break;

        if (!tee.destroyed) {
          const wrote = tee.write(chunkBuf);
          if (!wrote) await once(tee, 'drain');
        }
      }
    } catch (err) {
      logger?.error?.({ step: 'stream:passthrough_finish_error', error: err?.message || String(err) });
    } finally {
      if (!blocked && !tee.destroyed) tee.end();
    }
    try {
      await finished(tee);
    } catch (err) {
      logger?.error?.({ step: 'stream:passthrough_finish_error', error: err?.message || String(err) });
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
              logger?.warn?.({ step: 'stream:passthrough_drop', reason: 'live_chunk_blocked', api_key_name: result.apiKeyName, pattern_id: result.patternId, details: result.details || {} });
              destroyStreams(new Error('response_stream_blocked'));
            }
          })
          .catch((err) => {
            inspecting = false;
            logger?.error?.({ step: 'stream:inspect_error', error: err?.message || String(err) });
          });
      }
    });

    source.pipe(tee);
    reply.send(tee);

    try {
      await finished(tee);
    } catch (err) {
      logger?.error?.({ step: 'stream:passthrough_finish_error', error: err?.message || String(err) });
    }
  }

  return {
    status: res.statusCode,
    headers: responseHeaders,
    body: responseBody,
    streamed: true
  };
}

export function startBuffered(url, init, logger) {
  const controller = new AbortController();
  const promise = undiciRequest(url, { ...init, signal: controller.signal })
    .then(async (res) => {
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
