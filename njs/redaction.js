// /etc/nginx/njs/redaction.js

import { extractSegments, getPathAccessor, makeLogger, safeJsonParse } from './utils.js';

export function collectRedactionPlan(sbJson) {
  const results = ((((sbJson || {}).result) || {}).scannerResults) || [];
  const matches = [];
  const unsupported = [];
  let failedCount = 0;

  if (!Array.isArray(results)) {
    return { matches, unsupported, failedCount };
  }

  for (let i = 0; i < results.length; i++) {
    const res = results[i] || {};
    const outcome = (res.outcome || '').toLowerCase();
    if (outcome !== 'failed' && outcome !== 'redacted') {
      continue;
    }
    failedCount++;
    const data = res.data;
    const type = data && data.type ? String(data.type).toLowerCase() : '';
    if (type !== 'regex') {
      unsupported.push({
        scannerId: res.scannerId || 'unknown',
        reason: `unsupported type: ${type || 'unknown'}`
      });
      continue;
    }

    let rawMatches;
    if (Array.isArray(data.matches)) {
      rawMatches = data.matches;
    } else if (data.match) {
      rawMatches = [data.match];
    }

    if (!rawMatches || !rawMatches.length) {
      unsupported.push({
        scannerId: res.scannerId || 'unknown',
        reason: 'regex failure with no match offsets'
      });
      continue;
    }

    for (let j = 0; j < rawMatches.length; j++) {
      const entry = rawMatches[j];

      if (Array.isArray(entry) && entry.length >= 2) {
        const rawStart = Number(entry[0]);
        const rawEnd   = Number(entry[1]);
        if (Number.isNaN(rawStart) || Number.isNaN(rawEnd)) continue;
        const start = Math.max(0, rawStart - 1);
        const end   = Math.max(start + 1, rawEnd);
        if (end > start) {
          matches.push({ start, end, rawStart, rawEnd });
        }
      } else if (entry && typeof entry.start === 'number' && typeof entry.end === 'number') {
        const rawStart = Number(entry.start);
        const rawEnd   = Number(entry.end);
        if (Number.isNaN(rawStart) || Number.isNaN(rawEnd)) continue;
        const start = Math.max(0, rawStart - 1);
        const end   = Math.max(start + 1, rawEnd);
        if (end > start) {
          matches.push({ start, end, rawStart, rawEnd });
        }
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
      if (next.end > current.end) current.end = next.end;
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
  const length = chars.length;

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const start = Math.max(0, range.start);
    const end   = Math.min(length, range.end);
    for (let idx = start; idx < end; idx++) {
      chars[idx] = '*';
    }
  }

  return chars.join('');
}

export function applyRedactions(context, matches, log, label) {
  if (!Array.isArray(matches) || !matches.length) {
    return { applied: false, text: undefined, unmatched: 0 };
  }
  if (!context || !context.parsed || !Array.isArray(context.segments) || !context.segments.length) {
    return { applied: false, text: undefined, unmatched: matches.length };
  }

  const rangesByPath = new Map();
  const covered = matches.map(() => false);
  const misses = [];

  for (let i = 0; i < context.segments.length; i++) {
    const seg = context.segments[i];
    for (let j = 0; j < matches.length; j++) {
      const match = matches[j];
      if (match.end <= seg.start || match.start >= seg.end) continue;
      const clippedStart = Math.max(seg.start, match.start) - seg.start;
      const clippedEnd   = Math.min(seg.end, match.end) - seg.start;
      if (clippedEnd <= clippedStart) continue;

      covered[j] = true;
      if (!rangesByPath.has(seg.path)) rangesByPath.set(seg.path, []);
      rangesByPath.get(seg.path).push({ start: clippedStart, end: clippedEnd });
    }
  }

  if (!rangesByPath.size) {
    const unmatchedAll = covered.filter((seen) => !seen).length;
    for (let k = 0; k < covered.length; k++) {
      if (!covered[k]) misses.push(matches[k]);
    }
    if (misses.length) {
      log({
        step: `${label}:redact_no_overlap`,
        matches: misses.map((m) => ({ start: m.start, end: m.end, rawStart: m.rawStart, rawEnd: m.rawEnd }))
      }, 'warn');
    }
    return { applied: false, text: undefined, unmatched: unmatchedAll };
  }

  const touchedPaths = [];
  let mutated = false;

  for (const [path, ranges] of rangesByPath.entries()) {
    const accessor = getPathAccessor(context.parsed, path, { log, r: undefined });
    if (!accessor) continue;

    const value = accessor.value;
    if (typeof value !== 'string') {
      log({ step: `${label}:redact_skip_nonstring`, path, value_type: typeof value }, 'warn');
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
    const unmatchedAll = covered.filter((seen) => !seen).length;
    for (let k = 0; k < covered.length; k++) {
      if (!covered[k]) misses.push(matches[k]);
    }
    if (misses.length) {
      log({
        step: `${label}:redact_not_mutated`,
        matches: misses.map((m) => ({ start: m.start, end: m.end, rawStart: m.rawStart, rawEnd: m.rawEnd })),
        ranges: Array.from(rangesByPath.entries()).map(([path, ranges]) => ({ path, ranges }))
      }, 'warn');
    }
    return { applied: false, text: undefined, unmatched: unmatchedAll };
  }

  const text = JSON.stringify(context.parsed);
  const unmatched = covered.filter((seen) => !seen).length;

  log({
    step: `${label}:redacted`,
    paths: touchedPaths,
    match_count: matches.length,
    unmatched
  }, 'info');
  return { applied: true, text, paths: touchedPaths, unmatched };
}

export function extractContextPayload(bodyText, paths, log, label) {
  const parsed = bodyText ? safeJsonParse(bodyText) : undefined;

  if (!parsed) {
    log(`${label}: not valid JSON; extracted empty string`, 'warn');
    return { extracted: '', parsed: undefined, segments: [] };
  }

  if (!paths || !paths.length) {
    // For streaming responses, use the entire parsed body so guardrails see full context.
    const full = JSON.stringify(parsed);
    log({ step: `${label}:extracted_full`, preview: full.slice(0, 200) }, 'debug');
    return { extracted: full, parsed, segments: [] };
  }

  const result = extractSegments(parsed, paths, ' ', { log, r: undefined });
  log({ step: `${label}:extracted`, preview: result.text.slice(0, 200) }, 'debug');
  return { extracted: result.text, parsed, segments: result.segments };
}
