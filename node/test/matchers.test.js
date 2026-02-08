import { describe, it, expect, vi } from 'vitest';
import { evaluateMatchers, selectApiKeyForPattern } from '../src/pipeline/inspectionHelpers.js';

describe('evaluateMatchers', () => {
  it('returns not matched when no urlRegex configured', () => {
    const res = evaluateMatchers({}, [], {});
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('no_url_regex_configured');
  });

  it('returns not matched when urlRegex is empty string', () => {
    const res = evaluateMatchers({}, [], { urlRegex: '', requestUrl: '/test' });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('no_url_regex_configured');
  });

  it('returns matched when urlRegex matches and no body matchers', () => {
    const res = evaluateMatchers({}, [], { urlRegex: '^/v1/chat', requestUrl: '/v1/chat/completions' });
    expect(res.matched).toBe(true);
  });

  it('returns not matched when urlRegex does not match', () => {
    const res = evaluateMatchers({}, [], { urlRegex: '^/v2/', requestUrl: '/v1/chat' });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('url_regex_mismatch');
  });

  it('returns not matched for invalid regex', () => {
    const res = evaluateMatchers({}, [], { urlRegex: '[invalid(', requestUrl: '/test' });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('invalid_url_regex');
  });

  it('validates body matchers after URL matches', () => {
    const parsed = { message: { content: 'hello world' } };
    const res = evaluateMatchers(parsed, [
      { path: '.message.content', contains: 'world' }
    ], { urlRegex: '^/api', requestUrl: '/api/test' });
    expect(res.matched).toBe(true);
  });

  it('rejects when URL matches but body matchers fail', () => {
    const parsed = { message: { content: 'hello' } };
    const res = evaluateMatchers(parsed, [
      { path: '.message.content', equals: 'nope' }
    ], { urlRegex: '^/api', requestUrl: '/api/test' });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('equals_mismatch');
  });

  it('rejects when JSON missing and matchers require data', () => {
    const res = evaluateMatchers(undefined, [{ path: '.foo', exists: true }], { urlRegex: '^/test', requestUrl: '/test' });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('no_json');
  });

  it('validates exists/equals/contains semantics with URL match', () => {
    const parsed = { message: { content: 'hello world', safe: true } };
    expect(evaluateMatchers(parsed, [
      { path: '.message.content', contains: 'world' },
      { path: '.message.safe', equals: true },
      { path: '.message.content', exists: true },
    ], { urlRegex: '.*', requestUrl: '/any' })).toEqual({ matched: true });

    const mismatch = evaluateMatchers(parsed, [{ path: '.message.content', equals: 'nope' }], { urlRegex: '.*', requestUrl: '/any' });
    expect(mismatch.matched).toBe(false);
    expect(mismatch.reason).toBe('equals_mismatch');
  });

  it('handles array index shorthand and missing accessors', () => {
    const parsed = { messages: [{ content: 'a' }, { content: 'b' }] };
    const ok = evaluateMatchers(parsed, [{ path: '.messages[-1].content', equals: 'b' }], { urlRegex: '.*', requestUrl: '/test' });
    expect(ok.matched).toBe(true);

    const bad = evaluateMatchers(parsed, [{ path: '.messages[5].content', exists: true }], { urlRegex: '.*', requestUrl: '/test' });
    expect(bad.matched).toBe(false);
    expect(bad.reason).toBe('exists_false');
  });

  it('ignores empty equals/contains values to avoid false mismatches', () => {
    const parsed = { messages: [{ content: 'hello' }] };
    const res = evaluateMatchers(parsed, [{
      path: '.messages[-1].content',
      equals: '',
      contains: '',
      exists: true
    }], { urlRegex: '.*', requestUrl: '/test' });
    expect(res.matched).toBe(true);
  });

  it('matches URL with query string', () => {
    const res = evaluateMatchers({}, [], { urlRegex: '/chat\\?stream=true', requestUrl: '/chat?stream=true' });
    expect(res.matched).toBe(true);
  });
});

describe('selectApiKeyForPattern', () => {
  const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn() };

  it('skips running when no urlRegex configured', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p1', matchers: [{ path: '.foo', equals: 'bar' }], apiKeyName: 'k1' };
    const res = selectApiKeyForPattern(context, pattern, [{ name: 'k1', key: 't' }], 'fallback', logger, 'request', '/test');
    expect(res.shouldRun).toBe(false);
    expect(res.matched).toBe(false);
  });

  it('skips running when urlRegex does not match', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p1', urlRegex: '^/v2/', matchers: [{ path: '.foo', equals: 'bar' }], apiKeyName: 'k1' };
    const res = selectApiKeyForPattern(context, pattern, [{ name: 'k1', key: 't' }], 'fallback', logger, 'request', '/v1/test');
    expect(res.shouldRun).toBe(false);
    expect(res.matched).toBe(false);
  });

  it('skips running when body matchers miss (after URL matches)', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p1', urlRegex: '^/v1/', matchers: [{ path: '.foo', equals: 'nope' }], apiKeyName: 'k1' };
    const res = selectApiKeyForPattern(context, pattern, [{ name: 'k1', key: 't' }], 'fallback', logger, 'request', '/v1/test');
    expect(res.shouldRun).toBe(false);
    expect(res.matched).toBe(false);
    expect(res.apiKeyName).toBe('k1');
  });

  it('returns api key token when URL and body pattern match', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p2', urlRegex: '^/v1/', matchers: [{ path: '.foo', equals: 'bar' }], apiKeyName: 'k2' };
    const apiKeys = [{ name: 'k2', key: 'token-123' }];
    const res = selectApiKeyForPattern(context, pattern, apiKeys, 'fallback', logger, 'response', '/v1/chat');
    expect(res.shouldRun).toBe(true);
    expect(res.bearer).toBe('token-123');
    expect(res.apiKeyName).toBe('k2');
    expect(logger.info).toHaveBeenCalled();
  });

  it('returns api key token when URL matches and no body matchers', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p2', urlRegex: '^/v1/', matchers: [], apiKeyName: 'k2' };
    const apiKeys = [{ name: 'k2', key: 'token-123' }];
    const res = selectApiKeyForPattern(context, pattern, apiKeys, 'fallback', logger, 'response', '/v1/chat');
    expect(res.shouldRun).toBe(true);
    expect(res.bearer).toBe('token-123');
    expect(res.apiKeyName).toBe('k2');
  });

  it('falls back to default bearer when api key missing', () => {
    const context = { parsed: { foo: 'bar' } };
    const pattern = { id: 'p3', urlRegex: '.*', apiKeyName: 'missing' };
    const res = selectApiKeyForPattern(context, pattern, [], 'fallback-token', logger, 'response', '/any');
    expect(res.bearer).toBe('fallback-token');
    expect(res.shouldRun).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
