import { Readable } from 'stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildRequestInit,
  fetchBuffered,
  fetchStream,
  filterRequestHeaders,
  startBuffered,
  withBody
} from '../src/pipeline/backendClient.js';

var mockUndiciRequest;

vi.mock('undici', () => {
  mockUndiciRequest = vi.fn();
  return {
    default: { request: mockUndiciRequest },
    request: mockUndiciRequest
  };
});

vi.mock('../src/pipeline/dispatcher.js', () => {
  return {
    getDispatcher: vi.fn(() => 'agent')
  };
});

const fakeLog = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
});

beforeEach(() => {
  mockUndiciRequest.mockReset();
});

describe('filterRequestHeaders', () => {
  it('drops hop-by-hop headers and pins host + accept-encoding', () => {
    const next = filterRequestHeaders({
      host: 'original.example',
      connection: 'keep-alive',
      'proxy-connection': 'close',
      'content-length': '123',
      'transfer-encoding': 'chunked',
      foo: 'bar'
    }, 'api.example');

    expect(next.connection).toBeUndefined();
    expect(next['proxy-connection']).toBeUndefined();
    expect(next['content-length']).toBeUndefined();
    expect(next['transfer-encoding']).toBeUndefined();
    expect(next.host).toBe('api.example');
    expect(next['accept-encoding']).toBe('identity');
    expect(next.foo).toBe('bar');
  });
});

describe('buildRequestInit + withBody', () => {
  it('normalizes headers and omits body for GET/HEAD', () => {
    const request = { headers: { host: 'example', 'content-length': '10' }, method: 'GET', log: fakeLog() };
    const init = buildRequestInit(request, 'api.example', '/tmp/ca.crt');
    const withPayload = withBody(init, 'ignored');

    expect(init.method).toBe('GET');
    expect(init.headers.host).toBe('api.example');
    expect(init.headers['content-length']).toBeUndefined();
    expect(init.dispatcher).toBe('agent');
    expect(withPayload.body).toBeUndefined();
  });
});

describe('fetchBuffered', () => {
  it('buffers response body and clones headers', async () => {
    mockUndiciRequest.mockResolvedValueOnce({
      statusCode: 201,
      headers: { 'x-test': '1', 'transfer-encoding': 'chunked' },
      body: Readable.from(['hello', ' ', 'world'])
    });

    const result = await fetchBuffered('https://upstream.example/api', { method: 'POST', headers: {}, body: 'req-body' });

    expect(mockUndiciRequest).toHaveBeenCalledWith('https://upstream.example/api', { method: 'POST', headers: {}, body: 'req-body' });
    expect(result.status).toBe(201);
    expect(result.headers).toEqual({ 'x-test': '1' });
    expect(result.body).toBe('hello world');
  });
});

describe('fetchStream', () => {
  const logger = { warn: vi.fn(), error: vi.fn() };

  it('pipes headers and aborts when inspectChunk blocks gated stream', async () => {
    const reply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
      raw: {
        destroyed: false,
        destroy: vi.fn(function destroy() {
          this.destroyed = true;
        })
      }
    };

    mockUndiciRequest.mockResolvedValueOnce({
      statusCode: 206,
      headers: {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
        'x-upstream': '1',
        'transfer-encoding': 'chunked'
      },
      body: Readable.from(['hello ', 'world'])
    });

    const inspectChunk = vi.fn(async (bodySoFar) => {
      if (bodySoFar.includes('world')) {
        return { blocked: true, apiKeyName: 'k1', patternId: 'p1', details: { reason: 'found world' } };
      }
      return { blocked: false };
    });

    const res = await fetchStream(
      'https://upstream.example/stream',
      { method: 'GET', headers: {} },
      reply,
      inspectChunk,
      { gateChunks: true },
      logger
    );

    expect(reply.header).toHaveBeenCalledWith('content-type', 'text/event-stream');
    expect(reply.header).toHaveBeenCalledWith('x-upstream', '1');
    expect(reply.header).not.toHaveBeenCalledWith('content-length', expect.anything());
    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(reply.raw.destroyed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      step: 'stream:passthrough_drop',
      reason: 'live_chunk_blocked',
      api_key_name: 'k1',
      pattern_id: 'p1',
      details: { reason: 'found world' }
    }));
    expect(res.status).toBe(206);
    expect(res.streamed).toBe(true);
    expect(res.body).toBe('hello world');
  });
});

describe('startBuffered', () => {
  it('exposes an abort hook for in-flight upstream requests', async () => {
    let capturedSignal;
    mockUndiciRequest.mockImplementationOnce((_url, init) => {
      capturedSignal = init.signal;
      return new Promise((_, reject) => {
        capturedSignal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const { promise, abort } = startBuffered('https://example.com', { method: 'GET', headers: {} });
    abort();
    await expect(promise).rejects.toThrow('aborted');
  });
});
