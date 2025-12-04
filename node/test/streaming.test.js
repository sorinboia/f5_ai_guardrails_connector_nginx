import { PassThrough, Readable } from 'stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSseChunkTee } from '../src/pipeline/streaming.js';
import { _streamBackendPassthrough } from '../src/pipeline/proxyPipeline.js';

var mockUndiciRequest;

vi.mock('undici', () => {
  mockUndiciRequest = vi.fn();
  const Agent = class {};
  return {
    default: { request: mockUndiciRequest, Agent },
    request: mockUndiciRequest,
    Agent
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

describe('createSseChunkTee', () => {
  it('passes through data while counting overlapping chunks', async () => {
    const logger = { info: vi.fn() };
    const tee = createSseChunkTee({ chunkSize: 4, overlap: 1, logger });

    const output = [];
    tee.on('data', (buf) => output.push(buf.toString('utf8')));

    tee.write('abcd');
    tee.write('ef');
    tee.write('ghij');
    tee.end();

    await new Promise((resolve) => tee.on('finish', resolve));

    // Expect overlapping chunk windowing: buffer lengths trigger 4 chunks total.
    expect(logger.info).toHaveBeenCalledWith(
      { step: 'sse_chunk_probe', chunkSize: 4, overlap: 1, chunkCount: 4, bytesSeen: 10 },
      'SSE stream chunked (probe)'
    );
    expect(output.join('')).toBe('abcdefghij');
  });
});

describe('_streamBackendPassthrough chunk gating', () => {
  it('waits for live inspect before forwarding chunks when gating is enabled', async () => {
    const bodyStream = Readable.from(['chunk-1']);
    mockUndiciRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: bodyStream });

    const client = new PassThrough();
    client.on('error', () => {});
    const order = [];
    client.on('data', (buf) => order.push({ event: 'chunk', payload: buf.toString('utf8') }));

    const inspect = vi.fn(async () => {
      order.push({ event: 'inspect_start' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push({ event: 'inspect_end' });
      return { blocked: false };
    });

    const reply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: (stream) => stream.pipe(client),
      raw: client
    };
    const request = { headers: {}, method: 'GET', log: fakeLog() };

    const promise = _streamBackendPassthrough('http://example.com', request, '', 'example.com', null, reply, inspect, { gateChunks: true });
    const result = await promise;

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      { event: 'inspect_start' },
      { event: 'inspect_end' },
      { event: 'chunk', payload: 'chunk-1' }
    ]);
    expect(result.body).toBe('chunk-1');
  });

  it('drops the stream before forwarding a blocked chunk', async () => {
    const bodyStream = Readable.from(['ok', 'blocked']);
    mockUndiciRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: bodyStream });

    const client = new PassThrough();
    client.on('error', () => {});
    const received = [];
    client.on('data', (buf) => received.push(buf.toString('utf8')));

    const inspect = vi.fn()
      .mockImplementationOnce(() => ({ blocked: false }))
      .mockImplementationOnce(() => ({ blocked: true, apiKeyName: 'k1', patternId: 'p1' }));

    const reply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: (stream) => stream.pipe(client),
      raw: client
    };
    const log = fakeLog();
    const request = { headers: {}, method: 'GET', log };

    const result = await _streamBackendPassthrough('http://example.com', request, '', 'example.com', null, reply, inspect, { gateChunks: true });

    expect(inspect).toHaveBeenCalledTimes(2);
    expect(received.join('')).toBe('ok');
    expect(client.destroyed).toBe(true);
    expect(log.warn).toHaveBeenCalledWith({ step: 'stream:passthrough_drop', reason: 'live_chunk_blocked', api_key_name: 'k1', pattern_id: 'p1', details: {} });
    expect(result.body).toBe('okblocked');
  });
});
