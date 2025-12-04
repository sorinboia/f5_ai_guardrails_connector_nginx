import { describe, it, expect, vi } from 'vitest';
import {
  collectRedactionPlan,
  applyRedactions,
  extractContextPayload
} from '../src/pipeline/redaction.js';

function findMatch(text, needle) {
  const idx = text.indexOf(needle);
  if (idx === -1) return null;
  return { start: idx, end: idx + needle.length };
}

describe('collectRedactionPlan', () => {
  it('normalizes regex offsets, sorts them, and records unsupported scanners', () => {
    const sbJson = {
      result: {
        scannerResults: [
          { outcome: 'redacted', data: { type: 'regex', matches: [[2, 4], [1, 2]] }, scannerId: 's1' },
          { outcome: 'failed', data: { type: 'regex', matches: [{ start: 5, end: 7 }] }, scannerId: 's2' },
          { outcome: 'redacted', data: { type: 'keyword', matches: [[1, 3]] }, scannerId: 's3' },
        ]
      }
    };

    const plan = collectRedactionPlan(sbJson);

    expect(plan.failedCount).toBe(3);
    expect(plan.matches).toEqual([
      { start: 0, end: 2, rawStart: 1, rawEnd: 2 },
      { start: 1, end: 4, rawStart: 2, rawEnd: 4 },
      { start: 4, end: 7, rawStart: 5, rawEnd: 7 },
    ]);
    expect(plan.unsupported[0].scannerId).toBe('s3');
  });

  it('returns empty plan for missing or malformed scanner results', () => {
    expect(collectRedactionPlan({})).toEqual({ matches: [], unsupported: [], failedCount: 0 });
    expect(collectRedactionPlan({ result: { scannerResults: 'oops' } })).toEqual({ matches: [], unsupported: [], failedCount: 0 });
  });
});

describe('applyRedactions', () => {
  it('masks string values across overlapping ranges and returns mutated JSON', () => {
    const bodyText = JSON.stringify({ message: { content: 'hello SECRET data' } });
    const context = extractContextPayload(bodyText, ['.message.content']);
    const match = findMatch(context.extracted, 'SECRET');
    const matches = [{ start: match.start, end: match.end }];
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = applyRedactions(context, matches, log, 'request');

    expect(result.applied).toBe(true);
    expect(result.unmatched).toBe(0);
    expect(result.paths).toEqual(['.message.content']);
    expect(JSON.parse(result.text).message.content).toBe('hello ****** data');
  });

  it('reports unmatched ranges when no overlap occurs', () => {
    const bodyText = JSON.stringify({ message: { content: 'safe text' } });
    const context = extractContextPayload(bodyText, ['.message.content']);
    const matches = [{ start: 50, end: 60 }];
    const log = { warn: vi.fn() };

    const result = applyRedactions(context, matches, log, 'request');

    expect(result.applied).toBe(false);
    expect(result.unmatched).toBe(1);
    expect(log.warn).toHaveBeenCalledWith({
      step: 'request:redact_no_overlap',
      matches
    });
  });

  it('skips non-string paths and leaves unmatched flagged', () => {
    const bodyText = JSON.stringify({ message: { content: 'pii', extra: { nested: true } } });
    const context = extractContextPayload(bodyText, ['.message.extra']);
    // Matches are relative to extracted text (stringified object).
    const matches = [{ start: 1, end: 4 }];
    const log = { warn: vi.fn(), info: vi.fn() };

    const result = applyRedactions(context, matches, log, 'response');

    expect(result.applied).toBe(false);
    expect(result.unmatched).toBe(0);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('extractContextPayload', () => {
  it('returns parsed JSON and extracted segments for provided paths', () => {
    const body = '{"messages":[{"content":"a"},{"content":"b"}]}';
    const res = extractContextPayload(body, ['.messages[-1].content', '.messages[0].content']);

    expect(res.parsed.messages).toHaveLength(2);
    expect(res.extracted).toBe('b a ');
    expect(res.segments).toHaveLength(2);
    expect(res.segments[0]).toMatchObject({ path: '.messages[-1].content', start: 0, end: 1 });
  });

  it('warns and returns empty extraction when body is not JSON', () => {
    const log = { warn: vi.fn() };
    const res = extractContextPayload('not-json', ['.foo'], log, 'phase');
    expect(res.parsed).toBeUndefined();
    expect(res.segments).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });
});
