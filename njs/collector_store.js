export {
  readCollectorState,
  scheduleCollection,
  recordSample,
  clearCollection
};

import { makeLogger, readVar, safeJson, safeJsonParse } from './utils.js';

const MAX_STORED_ENTRIES = 50;

function toInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored >= 0 ? floored : fallback;
}

function readEntries(r) {
  const raw = readVar(r, 'collector_entries', '[]');
  const parsed = safeJsonParse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeEntries(r, entries, log) {
  const serialized = JSON.stringify(entries);
  try {
    r.variables.collector_entries = serialized;
  } catch (err) {
    if (log) log({ step: 'collector:error_write_entries', error: String(err) }, 'err');
  }
}

function readRemaining(r) {
  const raw = readVar(r, 'collector_collect_remaining', '0');
  return toInteger(raw, 0);
}

function writeRemaining(r, value, log) {
  try {
    r.variables.collector_collect_remaining = String(value);
  } catch (err) {
    if (log) log({ step: 'collector:error_write_remaining', error: String(err) }, 'err');
  }
}

function readTotal(r) {
  const raw = readVar(r, 'collector_collect_total', '0');
  return toInteger(raw, 0);
}

function writeTotal(r, value, log) {
  try {
    r.variables.collector_collect_total = String(value);
  } catch (err) {
    if (log) log({ step: 'collector:error_write_total', error: String(err) }, 'err');
  }
}

function buildEntry(sample) {
  const now = new Date();
  return {
    id: String(now.getTime()),
    collected_at: now.toISOString(),
    request: {
      body: sample && typeof sample.requestBody === 'string' ? sample.requestBody : ''
    },
    response: {
      body: sample && typeof sample.responseBody === 'string' ? sample.responseBody : ''
    }
  };
}

function trimEntries(entries) {
  if (!Array.isArray(entries)) return [];
  if (entries.length <= MAX_STORED_ENTRIES) return entries;
  return entries.slice(entries.length - MAX_STORED_ENTRIES);
}

function readCollectorState(r, opts) {
  const log = makeLogger({ log: opts && opts.log, r: opts && opts.r });
  const total = readTotal(r);
  const remaining = readRemaining(r);
  const entries = readEntries(r);
  log({ step: 'collector:read_state', total, remaining, entries_count: entries.length }, 'debug');
  return { total, remaining, entries };
}

function scheduleCollection(r, count, opts) {
  const log = makeLogger({ log: opts && opts.log, r: opts && opts.r });
  const target = toInteger(count, 0);
  const bounded = target > MAX_STORED_ENTRIES ? MAX_STORED_ENTRIES : target;

  writeTotal(r, bounded, log);
  writeRemaining(r, bounded, log);
  writeEntries(r, [], log);

  log({ step: 'collector:schedule', requested: count, target: bounded }, 'info');
  return { total: bounded, remaining: bounded, entries: [] };
}

function recordSample(r, sample, opts) {
  const log = makeLogger({ log: opts && opts.log, r: opts && opts.r });
  const remaining = readRemaining(r);
  if (remaining <= 0) {
    log({ step: 'collector:skip', reason: 'no_remaining_quota' }, 'debug');
    return { recorded: false, remaining: 0, total: readTotal(r), entries: readEntries(r) };
  }

  const entries = readEntries(r);
  const entry = buildEntry(sample);
  entries.push(entry);

  const trimmed = trimEntries(entries);
  const nextRemaining = remaining > 0 ? remaining - 1 : 0;

  writeEntries(r, trimmed, log);
  writeRemaining(r, nextRemaining, log);

  log({
    step: 'collector:recorded',
    remaining: nextRemaining,
    entries_count: trimmed.length,
    entry_id: entry.id,
    request_preview: entry.request.body.slice(0, 120),
    response_preview: entry.response.body.slice(0, 120)
  }, 'info');

  return {
    recorded: true,
    remaining: nextRemaining,
    total: readTotal(r),
    entries: trimmed
  };
}

function clearCollection(r, opts) {
  const log = makeLogger({ log: opts && opts.log, r: opts && opts.r });
  writeTotal(r, 0, log);
  writeRemaining(r, 0, log);
  writeEntries(r, [], log);
  log({ step: 'collector:cleared' }, 'info');
  return { total: 0, remaining: 0, entries: [] };
}
