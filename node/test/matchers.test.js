import { describe, it, expect, vi } from 'vitest';
import { evaluateMatchers, selectApiKeyForPattern } from '../src/pipeline/inspectionHelpers.js';

describe('evaluateMatchers', () => {
  it('returns matched when no matchers provided', () => {
    expect(evaluateMatchers({})).toEqual({ matched: true });
  });

  it('rejects when JSON missing and matchers require data', () => {
    const res = evaluateMatchers(undefined, [{ path: '.foo', exists: true }]);
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('no_json');
  });

  it('validates exists/equals/contains semantics', () => {
    const parsed = { message: { content: 'hello world', safe: true } };
    expect(evaluateMatchers(parsed, [
      { path: '.message.content', contains: 'world' },
      { path: '.message.safe', equals: true },
      { path: '.message.content', exists: true },
    ])).toEqual({ matched: true });

    const mismatch = evaluateMatchers(parsed, [{ path: '.message.content', equals: 'nope' }]);
    expect(mismatch.matched).toBe(false);
    expect(mismatch.reason).toBe('equals_mismatch');
  });

  it('handles array index shorthand and missing accessors', () => {
    const parsed = { messages: [{ content: 'a' }, { content: 'b' }] };
    const ok = evaluateMatchers(parsed, [{ path: '.messages[-1].content', equals: 'b' }]);
    expect(ok.matched).toBe(true);

    const bad = evaluateMatchers(parsed, [{ path: '.messages[5].content', exists: true }]);
    expect(bad.matched).toBe(false);
    expect(bad.reason).toBe('exists_false');
  });
});

describe('selectApiKeyForPattern', () => {
  const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn() };

  it('skips running when matchers miss', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p1', matchers: [{ path: '.foo', equals: 'nope' }], apiKeyName: 'k1' };
    const res = selectApiKeyForPattern(context, pattern, [{ name: 'k1', key: 't' }], 'fallback', logger, 'request');
    expect(res.shouldRun).toBe(false);
    expect(res.matched).toBe(false);
    expect(res.apiKeyName).toBe('k1');
  });

  it('returns api key token when pattern matches', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p2', matchers: [{ path: '.foo', equals: 'bar' }], apiKeyName: 'k2' };
    const apiKeys = [{ name: 'k2', key: 'token-123' }];
    const res = selectApiKeyForPattern(context, pattern, apiKeys, 'fallback', logger, 'response');
    expect(res.shouldRun).toBe(true);
    expect(res.bearer).toBe('token-123');
    expect(res.apiKeyName).toBe('k2');
    expect(logger.info).toHaveBeenCalled();
  });

  it('falls back to default bearer when api key missing', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p3', apiKeyName: 'missing' };
    const res = selectApiKeyForPattern(context, pattern, [], 'fallback-token', logger, 'response');
    expect(res.bearer).toBe('fallback-token');
    expect(res.shouldRun).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
