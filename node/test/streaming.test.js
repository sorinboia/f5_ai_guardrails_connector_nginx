import { PassThrough, Readable } from 'stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStream } from '../src/pipeline/backendClient.js';

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

describe('fetchStream chunk gating', () => {
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
    const log = fakeLog();

    const result = await fetchStream(
      'http://example.com',
      { method: 'GET', headers: { host: 'example.com' } },
      reply,
      inspect,
      { gateChunks: true },
      log
    );

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

    const result = await fetchStream(
      'http://example.com',
      { method: 'GET', headers: { host: 'example.com' } },
      reply,
      inspect,
      { gateChunks: true },
      log
    );

    expect(inspect).toHaveBeenCalledTimes(2);
    expect(received.join('')).toBe('ok');
    expect(client.destroyed).toBe(true);
    expect(log.warn).toHaveBeenCalledWith({ step: 'stream:passthrough_drop', reason: 'live_chunk_blocked', api_key_name: 'k1', pattern_id: 'p1', details: {} });
    expect(result.body).toBe('okblocked');
  });
});
