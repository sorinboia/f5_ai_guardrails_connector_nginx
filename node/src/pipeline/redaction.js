import { extractSegments, getPathAccessor, safeJsonParse } from './utils.js';

export function collectRedactionPlan(sbJson) {
  const results = (sbJson?.result?.scannerResults) || [];
  const matches = [];
  const unsupported = [];
  let failedCount = 0;

  if (!Array.isArray(results)) return { matches, unsupported, failedCount };

  for (let i = 0; i < results.length; i++) {
    const res = results[i] || {};
    const outcome = String(res.outcome || '').toLowerCase();
    if (outcome !== 'failed' && outcome !== 'redacted') continue;
    failedCount += 1;

    const data = res.data;
    const type = data?.type ? String(data.type).toLowerCase() : '';
    if (type !== 'regex') {
      unsupported.push({ scannerId: res.scannerId || 'unknown', reason: `unsupported type: ${type || 'unknown'}` });
      continue;
    }

    let rawMatches;
    if (Array.isArray(data?.matches)) rawMatches = data.matches;
    else if (data?.match) rawMatches = [data.match];
    if (!rawMatches || !rawMatches.length) {
      unsupported.push({ scannerId: res.scannerId || 'unknown', reason: 'regex failure with no match offsets' });
      continue;
    }

    for (let j = 0; j < rawMatches.length; j++) {
      const entry = rawMatches[j];
      let rawStart; let rawEnd;
      if (Array.isArray(entry) && entry.length >= 2) {
        rawStart = Number(entry[0]);
        rawEnd = Number(entry[1]);
      } else if (entry && typeof entry.start === 'number' && typeof entry.end === 'number') {
        rawStart = Number(entry.start);
        rawEnd = Number(entry.end);
      }
      if (Number.isNaN(rawStart) || Number.isNaN(rawEnd)) continue;
      const start = Math.max(0, rawStart - 1);
      const end = Math.max(start + 1, rawEnd);
      if (end > start) {
        matches.push({ start, end, rawStart, rawEnd });
      }
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return { matches, unsupported, failedCount };
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const merged = [];
  let current = { start: sorted[0].start, end: sorted[0].end };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { start: next.start, end: next.end };
    }
  }
  merged.push(current);
  return merged;
}

function maskString(value, ranges) {
  if (!ranges.length) return value;
  const chars = Array.from(value);
  for (let i = 0; i < ranges.length; i++) {
    const start = Math.max(0, ranges[i].start);
    const end = Math.min(chars.length, ranges[i].end);
    for (let idx = start; idx < end; idx++) {
      chars[idx] = '*';
    }
  }
  return chars.join('');
}

export function applyRedactions(context, matches, log, label) {
  if (!Array.isArray(matches) || !matches.length) {
    return { applied: false, text: undefined, unmatched: matches ? matches.length : 0 };
  }
  if (!context?.parsed || !Array.isArray(context.segments) || !context.segments.length) {
    return { applied: false, text: undefined, unmatched: matches.length };
  }

  const rangesByPath = new Map();
  const covered = matches.map(() => false);

  for (let i = 0; i < context.segments.length; i++) {
    const seg = context.segments[i];
    for (let j = 0; j < matches.length; j++) {
      const m = matches[j];
      if (m.end <= seg.start || m.start >= seg.end) continue;
      const clippedStart = Math.max(seg.start, m.start) - seg.start;
      const clippedEnd = Math.min(seg.end, m.end) - seg.start;
      if (clippedEnd <= clippedStart) continue;
      covered[j] = true;
      if (!rangesByPath.has(seg.path)) rangesByPath.set(seg.path, []);
      rangesByPath.get(seg.path).push({ start: clippedStart, end: clippedEnd });
    }
  }

  if (!rangesByPath.size) {
    const unmatched = covered.filter((seen) => !seen).length;
    if (unmatched && log) {
      log.warn?.({ step: `${label}:redact_no_overlap`, matches });
    }
    return { applied: false, text: undefined, unmatched };
  }

  const touchedPaths = [];
  let mutated = false;

  for (const [path, ranges] of rangesByPath.entries()) {
    const accessor = getPathAccessor(context.parsed, path);
    if (!accessor) continue;
    const value = accessor.value;
    if (typeof value !== 'string') {
      log?.warn?.({ step: `${label}:redact_skip_nonstring`, path, value_type: typeof value });
      continue;
    }
    const merged = mergeRanges(ranges);
    const masked = maskString(value, merged);
    if (masked !== value) {
      accessor.set(masked);
      mutated = true;
      touchedPaths.push(path);
    }
  }

  if (!mutated) {
    const unmatched = covered.filter((seen) => !seen).length;
    return { applied: false, text: undefined, unmatched };
  }

  const text = JSON.stringify(context.parsed);
  const unmatched = covered.filter((seen) => !seen).length;
  log?.info?.({ step: `${label}:redacted`, paths: touchedPaths, unmatched });
  return { applied: true, text, unmatched, paths: touchedPaths };
}

export function extractContextPayload(bodyText, paths, log, label) {
  const parsed = bodyText ? safeJsonParse(bodyText) : undefined;
  if (!parsed) {
    log?.warn?.({ step: `${label}:no_json`, preview: (bodyText || '').slice(0, 120) });
    return { extracted: '', parsed: undefined, segments: [] };
  }

  if (!paths || !paths.length) {
    const full = JSON.stringify(parsed);
    return { extracted: full, parsed, segments: [] };
  }

  const result = extractSegments(parsed, paths, ' ', log);
  return { extracted: result.text, parsed, segments: result.segments };
}
