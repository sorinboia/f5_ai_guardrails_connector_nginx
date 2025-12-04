const MAX_ENTRIES = 50;

function clampCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const floored = Math.floor(num);
  if (floored < 0) return 0;
  if (floored > MAX_ENTRIES) return MAX_ENTRIES;
  return floored;
}

function buildEntry(sample) {
  const now = new Date();
  return {
    id: String(now.getTime()),
    collected_at: now.toISOString(),
    request: { body: typeof sample.requestBody === 'string' ? sample.requestBody : '' },
    response: { body: typeof sample.responseBody === 'string' ? sample.responseBody : '' }
  };
}

function trimEntries(list) {
  if (!Array.isArray(list)) return [];
  if (list.length <= MAX_ENTRIES) return list;
  return list.slice(list.length - MAX_ENTRIES);
}

export function scheduleCollection(store, count) {
  const target = clampCount(count);
  store.collector.total = target;
  store.collector.remaining = target;
  store.collector.entries = [];
  return { total: target, remaining: target, entries: [] };
}

export function clearCollection(store) {
  store.collector.total = 0;
  store.collector.remaining = 0;
  store.collector.entries = [];
  return { total: 0, remaining: 0, entries: [] };
}

export function recordSample(store, sample) {
  const remaining = Number(store.collector?.remaining || 0);
  if (remaining <= 0) {
    return {
      recorded: false,
      remaining: store.collector?.remaining || 0,
      total: store.collector?.total || 0,
      entries: store.collector?.entries || []
    };
  }

  const entries = Array.isArray(store.collector.entries) ? store.collector.entries.slice() : [];
  entries.push(buildEntry(sample));
  const trimmed = trimEntries(entries);
  const nextRemaining = remaining > 0 ? remaining - 1 : 0;

  store.collector.entries = trimmed;
  store.collector.remaining = nextRemaining;
  // total remains as scheduled

  return {
    recorded: true,
    remaining: nextRemaining,
    total: store.collector?.total || trimmed.length,
    entries: trimmed
  };
}
