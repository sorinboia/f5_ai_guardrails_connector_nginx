import { describe, it, expect } from 'vitest';
import { buildHostAllowlist, isHostAllowed, normalizeHostList } from '../src/config/hosts.js';

describe('normalizeHostList', () => {
  it('dedupes and lowercases host names while preserving defaults', () => {
    const normalized = normalizeHostList(['__default__', 'Example.com', 'example.com', 'Other.COM ']);
    expect(normalized).toEqual(['__default__', 'example.com', 'other.com']);
  });
});

describe('buildHostAllowlist & isHostAllowed', () => {
  const store = {
    hosts: ['Example.com', '__default__'],
    hostConfigs: {
      'extra.example.com': {},
    }
  };

  it('includes hosts from both host list and configs', () => {
    const allowlist = buildHostAllowlist(store);
    expect(allowlist.has('example.com')).toBe(true);
    expect(allowlist.has('extra.example.com')).toBe(true);
    expect(allowlist.has('__default__')).toBe(false);
  });

  it('rejects default host and unknown destinations', () => {
    expect(isHostAllowed(store, '__default__')).toBe(false);
    expect(isHostAllowed(store, 'unknown.example.com')).toBe(false);
  });
});
