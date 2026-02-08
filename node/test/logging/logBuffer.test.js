import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogRingBuffer, generateId, matchesFilters, prepareFilters } from '../../src/logging/logBuffer.js';

describe('LogRingBuffer', () => {
  let buffer;

  beforeEach(() => {
    buffer = new LogRingBuffer(5);
  });

  describe('constructor', () => {
    it('creates buffer with default maxSize of 1000', () => {
      const defaultBuffer = new LogRingBuffer();
      expect(defaultBuffer.maxSize).toBe(1000);
    });

    it('creates buffer with custom maxSize', () => {
      expect(buffer.maxSize).toBe(5);
    });

    it('starts empty', () => {
      expect(buffer.size).toBe(0);
      expect(buffer.entries).toEqual([]);
    });
  });

  describe('push', () => {
    it('adds entry to buffer', () => {
      buffer.push({ message: 'test', level: 'info' });
      expect(buffer.size).toBe(1);
    });

    it('generates id if not provided', () => {
      buffer.push({ message: 'test' });
      expect(buffer.entries[0].id).toMatch(/^log_\d+_[a-z0-9]+$/);
    });

    it('preserves provided id', () => {
      buffer.push({ id: 'custom_id', message: 'test' });
      expect(buffer.entries[0].id).toBe('custom_id');
    });

    it('generates timestamp if not provided', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));

      buffer.push({ message: 'test' });
      expect(buffer.entries[0].timestamp).toBe('2024-01-15T10:30:00.000Z');

      vi.useRealTimers();
    });

    it('preserves provided timestamp', () => {
      buffer.push({ timestamp: '2023-06-01T00:00:00.000Z', message: 'test' });
      expect(buffer.entries[0].timestamp).toBe('2023-06-01T00:00:00.000Z');
    });

    it('evicts oldest entries when full', () => {
      for (let i = 1; i <= 7; i++) {
        buffer.push({ id: `log_${i}`, message: `msg ${i}` });
      }
      expect(buffer.size).toBe(5);
      expect(buffer.entries[0].id).toBe('log_3');
      expect(buffer.entries[4].id).toBe('log_7');
    });

    it('notifies subscribers', () => {
      const callback = vi.fn();
      buffer.subscribe({}, callback);

      buffer.push({ message: 'test' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].message).toBe('test');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      buffer = new LogRingBuffer(100);
      // Add test entries
      buffer.push({ id: 'log_1', host: 'api.openai.com', level: 'info', status: 'cleared', message: 'Request cleared', url: '/v1/chat' });
      buffer.push({ id: 'log_2', host: 'api.openai.com', level: 'warn', status: 'blocked', message: 'Request blocked', url: '/v1/chat', pattern_name: 'PII' });
      buffer.push({ id: 'log_3', host: 'api.anthropic.com', level: 'error', status: 'error', message: 'Connection failed', url: '/v1/messages' });
      buffer.push({ id: 'log_4', host: 'api.openai.com', level: 'info', status: 'redacted', message: 'Content redacted', url: '/v1/completions', pattern_name: 'SSN' });
      buffer.push({ id: 'log_5', host: 'api.anthropic.com', level: 'debug', status: 'skipped', message: 'Inspection skipped', url: '/v1/messages' });
    });

    it('returns all entries with no filters', () => {
      const result = buffer.query();
      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(5);
      expect(result.hasMore).toBe(false);
    });

    it('returns entries in reverse order (newest first)', () => {
      const result = buffer.query();
      expect(result.items[0].id).toBe('log_5');
      expect(result.items[4].id).toBe('log_1');
    });

    it('filters by host', () => {
      const result = buffer.query({ host: 'api.openai.com' });
      expect(result.total).toBe(3);
      expect(result.items.every(e => e.host === 'api.openai.com')).toBe(true);
    });

    it('filters by single level', () => {
      const result = buffer.query({ level: 'info' });
      expect(result.total).toBe(2);
      expect(result.items.every(e => e.level === 'info')).toBe(true);
    });

    it('filters by multiple levels (comma-separated)', () => {
      const result = buffer.query({ level: 'warn,error' });
      expect(result.total).toBe(2);
      expect(result.items.every(e => ['warn', 'error'].includes(e.level))).toBe(true);
    });

    it('filters by single status', () => {
      const result = buffer.query({ status: 'blocked' });
      expect(result.total).toBe(1);
      expect(result.items[0].status).toBe('blocked');
    });

    it('filters by multiple statuses (comma-separated)', () => {
      const result = buffer.query({ status: 'cleared,redacted' });
      expect(result.total).toBe(2);
      expect(result.items.every(e => ['cleared', 'redacted'].includes(e.status))).toBe(true);
    });

    it('filters by search in message', () => {
      const result = buffer.query({ search: 'blocked' });
      expect(result.total).toBe(1);
      expect(result.items[0].message).toContain('blocked');
    });

    it('filters by search in url', () => {
      const result = buffer.query({ search: 'completions' });
      expect(result.total).toBe(1);
      expect(result.items[0].url).toContain('completions');
    });

    it('filters by search in pattern_name', () => {
      const result = buffer.query({ search: 'PII' });
      expect(result.total).toBe(1);
      expect(result.items[0].pattern_name).toBe('PII');
    });

    it('search is case-insensitive', () => {
      const result = buffer.query({ search: 'pii' });
      expect(result.total).toBe(1);
    });

    it('combines multiple filters', () => {
      const result = buffer.query({ host: 'api.openai.com', level: 'info' });
      expect(result.total).toBe(2);
    });

    it('respects limit parameter', () => {
      const result = buffer.query({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(5);
    });

    it('clamps limit to 1-1000 range', () => {
      buffer = new LogRingBuffer(2000);
      for (let i = 0; i < 1500; i++) {
        buffer.push({ id: `log_${i}`, message: 'test' });
      }

      const result1 = buffer.query({ limit: 0 });
      expect(result1.items.length).toBeGreaterThanOrEqual(1);

      const result2 = buffer.query({ limit: 2000 });
      expect(result2.items.length).toBeLessThanOrEqual(1000);
    });

    it('supports cursor pagination with before parameter', () => {
      const result1 = buffer.query({ limit: 2 });
      expect(result1.items[0].id).toBe('log_5');
      expect(result1.items[1].id).toBe('log_4');
      expect(result1.cursor).toBe('log_4');

      const result2 = buffer.query({ limit: 2, before: result1.cursor });
      expect(result2.items[0].id).toBe('log_3');
      expect(result2.items[1].id).toBe('log_2');
    });

    it('returns cursor as last item id', () => {
      const result = buffer.query({ limit: 3 });
      expect(result.cursor).toBe('log_3');
    });

    it('returns null cursor when no items', () => {
      const result = buffer.query({ host: 'nonexistent' });
      expect(result.cursor).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all entries and returns count', () => {
      buffer.push({ message: 'a' });
      buffer.push({ message: 'b' });
      buffer.push({ message: 'c' });

      const count = buffer.clear();

      expect(count).toBe(3);
      expect(buffer.size).toBe(0);
    });

    it('returns 0 when already empty', () => {
      expect(buffer.clear()).toBe(0);
    });
  });

  describe('getAll', () => {
    beforeEach(() => {
      buffer.push({ id: 'log_1', level: 'info', message: 'first' });
      buffer.push({ id: 'log_2', level: 'warn', message: 'second' });
      buffer.push({ id: 'log_3', level: 'error', message: 'third' });
    });

    it('returns all entries in reverse order', () => {
      const all = buffer.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('log_3');
      expect(all[2].id).toBe('log_1');
    });

    it('applies filters', () => {
      const filtered = buffer.getAll({ level: 'warn,error' });
      expect(filtered).toHaveLength(2);
    });

    it('returns empty array when no matches', () => {
      const filtered = buffer.getAll({ level: 'debug' });
      expect(filtered).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = buffer.subscribe({}, callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('calls callback for matching entries', () => {
      const callback = vi.fn();
      buffer.subscribe({ level: 'error' }, callback);

      buffer.push({ level: 'info', message: 'info log' });
      buffer.push({ level: 'error', message: 'error log' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].level).toBe('error');
    });

    it('unsubscribe stops notifications', () => {
      const callback = vi.fn();
      const unsubscribe = buffer.subscribe({}, callback);

      buffer.push({ message: 'first' });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      buffer.push({ message: 'second' });
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('supports multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      buffer.subscribe({}, callback1);
      buffer.subscribe({ level: 'error' }, callback2);

      buffer.push({ level: 'error', message: 'test' });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('handles subscriber errors gracefully', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Subscriber error');
      });
      const goodCallback = vi.fn();

      buffer.subscribe({}, errorCallback);
      buffer.subscribe({}, goodCallback);

      // Should not throw
      expect(() => buffer.push({ message: 'test' })).not.toThrow();
      expect(goodCallback).toHaveBeenCalled();
    });
  });
});

describe('generateId', () => {
  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('generates IDs matching expected format', () => {
    const id = generateId();
    expect(id).toMatch(/^log_\d+_[a-z0-9]+$/);
  });
});

describe('prepareFilters', () => {
  it('returns null values for empty input', () => {
    const prepared = prepareFilters({});
    expect(prepared.host).toBeNull();
    expect(prepared.levelSet).toBeNull();
    expect(prepared.statusSet).toBeNull();
    expect(prepared.searchLower).toBeNull();
  });

  it('parses comma-separated level into Set', () => {
    const prepared = prepareFilters({ level: 'info, warn, ERROR' });
    expect(prepared.levelSet).toBeInstanceOf(Set);
    expect(prepared.levelSet.has('info')).toBe(true);
    expect(prepared.levelSet.has('warn')).toBe(true);
    expect(prepared.levelSet.has('error')).toBe(true);
  });

  it('lowercases search term', () => {
    const prepared = prepareFilters({ search: 'Test QUERY' });
    expect(prepared.searchLower).toBe('test query');
  });
});

describe('matchesFilters', () => {
  const entry = {
    host: 'api.openai.com',
    level: 'warn',
    status: 'blocked',
    message: 'Request blocked due to PII',
    url: '/v1/chat/completions',
    pattern_name: 'PII Detection'
  };

  it('matches when no filters', () => {
    expect(matchesFilters(entry, prepareFilters({}))).toBe(true);
  });

  it('matches host exactly', () => {
    expect(matchesFilters(entry, prepareFilters({ host: 'api.openai.com' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ host: 'api.anthropic.com' }))).toBe(false);
  });

  it('matches level in set', () => {
    expect(matchesFilters(entry, prepareFilters({ level: 'warn' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ level: 'info,warn' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ level: 'info,error' }))).toBe(false);
  });

  it('matches status in set', () => {
    expect(matchesFilters(entry, prepareFilters({ status: 'blocked' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ status: 'cleared,blocked' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ status: 'cleared' }))).toBe(false);
  });

  it('searches in message, url, and pattern_name', () => {
    expect(matchesFilters(entry, prepareFilters({ search: 'blocked' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ search: 'completions' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ search: 'PII Detection' }))).toBe(true);
    expect(matchesFilters(entry, prepareFilters({ search: 'nonexistent' }))).toBe(false);
  });
});
