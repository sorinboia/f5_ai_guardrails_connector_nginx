import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/pipeline/sidebandClient.js', () => ({
  callSideband: vi.fn()
}));

import { runInspectionPhase, processInspectionStage } from '../src/pipeline/inspectionHelpers.js';
import { callSideband } from '../src/pipeline/sidebandClient.js';

const baseSideband = {
  url: 'http://sideband.local',
  bearer: 'test-bearer',
  timeout: 500,
  caBundle: null,
  testsLocalOverride: null,
  hostHeader: 'example.com',
  ua: 'unit-test'
};

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runInspectionPhase', () => {
  it('blocks flagged outcomes and surfaces api key metadata', async () => {
    callSideband.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: { outcome: 'flagged' } }) });

    const res = await runInspectionPhase({
      phase: 'response',
      bodyText: JSON.stringify({ message: { content: 'unsafe' } }),
      paths: ['.message.content'],
      inspectEnabled: true,
      redactEnabled: true,
      log: logger,
      sideband: baseSideband,
      pattern: { id: 'p1', apiKeyName: 'special' },
      apiKeys: [{ name: 'special', key: 'token' }]
    });

    expect(res.status).toBe('blocked');
    expect(res.outcome).toBe('flagged');
    expect(res.apiKeyName).toBe('special');
  });

  it('blocks redaction outcomes when redaction is disabled', async () => {
    callSideband.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ result: { outcome: 'redacted', scannerResults: [] } })
    });

    const res = await runInspectionPhase({
      phase: 'response',
      bodyText: JSON.stringify({ message: { content: 'secret' } }),
      paths: ['.message.content'],
      inspectEnabled: true,
      redactEnabled: false,
      log: logger,
      sideband: baseSideband,
      pattern: { id: 'p2', apiKeyName: 'k1' },
      apiKeys: [{ name: 'k1', key: 'token' }]
    });

    expect(res.status).toBe('blocked');
    expect(res.details?.reason).toBe('response redaction disabled');
  });

  it('applies sideband redaction when enabled', async () => {
    callSideband.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({
        result: {
          outcome: 'redacted',
          scannerResults: [
            { outcome: 'redacted', data: { type: 'regex', matches: [[1, 5]] } }
          ]
        }
      })
    });

    const res = await runInspectionPhase({
      phase: 'request',
      bodyText: JSON.stringify({ message: { content: 'secret token' } }),
      paths: ['.message.content'],
      inspectEnabled: true,
      redactEnabled: true,
      log: logger,
      sideband: baseSideband,
      pattern: { id: 'p3', apiKeyName: 'k2' },
      apiKeys: [{ name: 'k2', key: 'token' }]
    });

    expect(res.status).toBe('redacted');
    expect(res.bodyText).toContain('*****t token');
  });
});

describe('processInspectionStage', () => {
  it('runs extractors in parallel without attempting redaction', async () => {
    callSideband.mockResolvedValue({ status: 200, text: JSON.stringify({ result: { outcome: 'cleared' } }) });

    const res = await processInspectionStage({
      phase: 'request',
      body: JSON.stringify({ messages: [{ content: 'hello' }] }),
      fallbackPaths: ['.messages[-1].content'],
      patternsList: [
        { id: 'pat1', apiKeyName: 'k-default', matchers: [{ path: '.messages[-1].content', equals: 'hello' }] }
      ],
      inspectEnabled: true,
      redactEnabled: true,
      parallelExtractors: true,
      sideband: baseSideband,
      apiKeys: [{ name: 'k-default', key: 'token' }],
      log: logger
    });

    expect(res.status).toBe('cleared');
    expect(callSideband).toHaveBeenCalledTimes(1);
  });
});
