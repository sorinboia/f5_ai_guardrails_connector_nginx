import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { describe, it, expect } from 'vitest';
import { defaultStore, validateStoreShape, loadStore } from '../src/config/store.js';

describe('validateStoreShape', () => {
  it('accepts a well-formed store and normalizes hosts', () => {
    const candidate = {
      version: 2,
      hosts: [' Example.COM '],
      hostConfigs: {
        'Example.COM': { inspectMode: 'request' }
      },
      apiKeys: [],
      patterns: [],
      collector: { entries: [], total: 1, remaining: 0 }
    };

    const result = validateStoreShape(candidate);

    expect(result.ok).toBe(true);
    expect(result.store.hosts).toEqual(['__default__', 'example.com']);
    expect(result.store.hostConfigs['example.com']).toMatchObject({ inspectMode: 'request' });
    expect(result.store.version).toBe(2);
  });

  it('rejects malformed store shapes', () => {
    const badStore = {
      hosts: 'not-an-array',
      hostConfigs: [],
      apiKeys: {},
      patterns: {},
      collector: null
    };

    const result = validateStoreShape(badStore);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('hosts must be an array');
  });
});

describe('loadStore', () => {
  it('falls back to default when validation fails', () => {
    const tmpPath = path.join(tmpdir(), `store-invalid-${Date.now()}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify({ hosts: 'oops', hostConfigs: {}, apiKeys: [], patterns: [], collector: {} }));
    const store = loadStore({ warn: () => {} }, tmpPath);
    expect(store).toEqual(defaultStore());
    fs.unlinkSync(tmpPath);
  });
});
