import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('undici', () => {
  return {
    Agent: vi.fn(() => ({})),
    fetch: vi.fn(),
  };
});

vi.mock('fs', () => {
  return {
    readFileSync: vi.fn(() => '-----BEGIN CERT-----'),
  };
});

import { fetch } from 'undici';
import { callSideband } from '../src/pipeline/sidebandClient.js';

describe('callSideband', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts JSON to Guardrails and returns status/text', async () => {
    fetch.mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve('ok'),
    });

    const result = await callSideband({
      url: 'https://example.com/scan',
      bearer: 'token123',
      payload: '{"foo":"bar"}',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const args = fetch.mock.calls[0][1];
    expect(args.method).toBe('POST');
    expect(args.headers.authorization).toBe('Bearer token123');
    expect(result).toEqual({ status: 200, text: 'ok' });
  });

  it('uses testsLocalOverride when Host is tests.local', async () => {
    fetch.mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve('override'),
    });

    await callSideband({
      url: 'https://example.com/scan',
      testsLocalOverride: 'http://127.0.0.1:18081/backend/v1/scans',
      hostHeader: 'tests.local',
      bearer: 'token123',
      payload: '{}',
    });

    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:18081/backend/v1/scans');
  });

  it('returns 599 on abort/timeout errors', async () => {
    fetch.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    vi.useFakeTimers();

    const result = await callSideband({
      url: 'https://example.com/scan',
      bearer: 't',
      payload: '{}',
      timeoutMs: 10,
    });

    // run pending timers to trigger abort controller if needed
    vi.runAllTimers();

    expect(result.status).toBe(599);
  });
});
