import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defaultStore } from '../src/config/store.js';
import { scheduleCollection, recordSample, clearCollection } from '../src/pipeline/collector.js';

describe('collector', () => {
  let store;

  beforeEach(() => {
    store = defaultStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules collection and clamps to 50 entries', () => {
    const { total, remaining } = scheduleCollection(store, 75);
    expect(total).toBe(50);
    expect(remaining).toBe(50);
    expect(store.collector.entries).toHaveLength(0);
  });

  it('records samples until remaining hits zero', () => {
    scheduleCollection(store, 2);

    const first = recordSample(store, { requestBody: 'req1', responseBody: 'resp1' });
    const second = recordSample(store, { requestBody: 'req2', responseBody: 'resp2' });
    const third = recordSample(store, { requestBody: 'req3', responseBody: 'resp3' });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true);
    expect(third.recorded).toBe(false);
    expect(store.collector.entries).toHaveLength(2);
    expect(store.collector.remaining).toBe(0);
    expect(store.collector.entries[0]).toMatchObject({
      id: '1704164645000',
      collected_at: '2024-01-02T03:04:05.000Z',
      request: { body: 'req1' },
      response: { body: 'resp1' },
    });
  });

  it('trims entries to 50 when prepopulated list overflows', () => {
    scheduleCollection(store, 3);
    store.collector.entries = Array.from({ length: 49 }, (_, idx) => ({ id: String(idx) }));
    store.collector.remaining = 3;

    recordSample(store, { requestBody: 'a', responseBody: 'a' });
    recordSample(store, { requestBody: 'b', responseBody: 'b' });
    recordSample(store, { requestBody: 'c', responseBody: 'c' });

    expect(store.collector.entries).toHaveLength(50);
    expect(store.collector.remaining).toBe(0);
  });

  it('clears collection state', () => {
    scheduleCollection(store, 5);
    recordSample(store, { requestBody: 'req', responseBody: 'resp' });

    const cleared = clearCollection(store);

    expect(cleared).toMatchObject({ total: 0, remaining: 0, entries: [] });
    expect(store.collector.entries).toEqual([]);
  });
});
