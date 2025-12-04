import { describe, it, expect } from 'vitest';
import { validateConfigPatch, resolveConfig, normalizeHostName } from '../src/config/validate.js';
import { defaultStore, SCAN_CONFIG_DEFAULTS } from '../src/config/store.js';

describe('normalizeHostName', () => {
  it('normalizes case and trims whitespace with default fallback', () => {
    expect(normalizeHostName(' Example.COM ')).toBe('example.com');
    expect(normalizeHostName('')).toBe('__default__');
    expect(normalizeHostName()).toBe('__default__');
  });
});

describe('validateConfigPatch', () => {
  it('accepts valid patch values and coerces enums/booleans', () => {
    const patch = {
      inspectMode: 'response',
      redactMode: 'on',
      logLevel: 'warn',
      requestForwardMode: 'parallel',
      backendOrigin: 'https://example.com',
      requestExtractors: ['req_a', 'req_b'],
      responseExtractors: ['resp_a'],
      extractorParallelEnabled: '1',
      responseStreamEnabled: 'false',
      responseStreamFinalEnabled: 1,
      responseStreamCollectFullEnabled: 'yes',
      responseStreamChunkGatingEnabled: 'true',
      responseStreamChunkSize: 4096,
      responseStreamChunkOverlap: 128,
    };

    const { errors, updates } = validateConfigPatch(patch);

    expect(errors).toHaveLength(0);
    expect(updates).toMatchObject({
      inspectMode: 'response',
      redactMode: 'both', // coerced from "on"
      logLevel: 'warn',
      requestForwardMode: 'parallel',
      backendOrigin: 'https://example.com',
      requestExtractors: ['req_a', 'req_b'],
      responseExtractors: ['resp_a'],
      extractorParallel: true,
      responseStreamEnabled: false,
      responseStreamFinalEnabled: true,
      responseStreamCollectFullEnabled: true,
      responseStreamChunkGatingEnabled: true,
      responseStreamChunkSize: 4096,
      responseStreamChunkOverlap: 128,
    });
  });

  it('rejects invalid enums and chunk overlap/size relationships', () => {
    const { errors } = validateConfigPatch({
      inspectMode: 'maybe',
      requestExtractors: 'not-an-array',
      responseStreamChunkSize: 256,
      responseStreamChunkOverlap: 512,
    });

    expect(errors).toEqual([
      'invalid inspectMode',
      'requestExtractors must be array',
      'responseStreamChunkOverlap must be less than responseStreamChunkSize',
    ]);
  });
});

describe('resolveConfig', () => {
  it('merges host overrides with defaults and derives extractor fields', () => {
    const store = defaultStore();
    store.hosts.push('api.example.com');
    store.hostConfigs['api.example.com'] = {
      ...SCAN_CONFIG_DEFAULTS,
      inspectMode: 'request',
      requestExtractors: ['json.req'],
      responseExtractors: ['json.resp'],
      extractorParallel: true,
      backendOrigin: 'http://127.0.0.1:18080',
    };

    const resolved = resolveConfig(store, 'api.example.com');

    expect(resolved.inspectMode).toBe('request');
    expect(resolved.requestExtractor).toBe('json.req');
    expect(resolved.responseExtractor).toBe('json.resp');
    expect(resolved.extractorParallelEnabled).toBe(true);
    expect(resolved.backendOrigin).toBe('http://127.0.0.1:18080');

    const fallback = resolveConfig(store);
    expect(fallback.inspectMode).toBe(SCAN_CONFIG_DEFAULTS.inspectMode);
    expect(fallback.backendOrigin).toBe(SCAN_CONFIG_DEFAULTS.backendOrigin);
  });
});
