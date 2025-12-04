import { safeJson } from './safeJson.js';

export const REQUEST_PATHS_DEFAULT = ['.messages[-1].content'];
export const RESPONSE_PATHS_DEFAULT = ['.message.content'];
export const STREAM_CHUNK_SIZE_DEFAULT = 2048;
export const STREAM_CHUNK_OVERLAP_DEFAULT = 128;

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return undefined;
  }
}

export function isModeEnabled(mode, target) {
  if (!mode) return false;
  const normalized = String(mode).toLowerCase();
  if (['off', 'false', '0'].includes(normalized)) return false;
  if (['both', 'all', 'on', 'true'].includes(normalized)) return true;
  return normalized === target;
}

function pathSegments(path) {
  if (!path || typeof path !== 'string') return [];
  const trimmed = path.startsWith('.') ? path.slice(1) : path;
  return trimmed.split('.').filter(Boolean).map((part) => {
    const match = part.match(/(.+)\[(-?\d+)\]$/);
    if (match) {
      return { key: match[1], index: Number(match[2]) };
    }
    return { key: part };
  });
}

export function getPathAccessor(root, path) {
  const segments = pathSegments(path);
  if (!segments.length) return undefined;

  let cur = root;
  let parent = null;
  let keyOrIndex = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    parent = cur;
    keyOrIndex = seg.key;
    if (cur === undefined || cur === null) return undefined;

    if (seg.index !== undefined) {
      cur = cur[seg.key];
      if (!Array.isArray(cur)) return undefined;
      const idx = seg.index === -1 ? cur.length - 1 : seg.index;
      if (idx < 0 || idx >= cur.length) return undefined;
      parent = cur;
      keyOrIndex = idx;
      cur = cur[idx];
    } else {
      cur = cur[seg.key];
    }
  }

  if (parent === null) return undefined;
  return {
    value: cur,
    set(next) {
      parent[keyOrIndex] = next;
    }
  };
}

export function extractSegments(root, searches, delimiter = ' ', logger = null) {
  if (!root || !Array.isArray(searches)) {
    logger?.warn?.({ step: 'extractSegments:invalid_inputs' });
    return { text: '', segments: [] };
  }

  const segments = [];
  const delim = delimiter ?? '';
  let out = '';

  for (let i = 0; i < searches.length; i++) {
    const path = String(searches[i]);
    const accessor = getPathAccessor(root, path);
    const rawValue = accessor ? accessor.value : undefined;

    let strValue = '';
    if (rawValue === undefined || rawValue === null) {
      strValue = '';
    } else if (typeof rawValue === 'object') {
      strValue = safeJson(rawValue);
    } else {
      strValue = String(rawValue);
    }

    const start = out.length;
    out += strValue;
    const end = out.length;
    segments.push({
      path,
      start,
      end,
      length: strValue.length,
      valueType: typeof rawValue
    });
    out += delim;
  }

  return { text: out, segments };
}

export function sliceTextChunks(text, size, overlap) {
  const chunks = [];
  if (!text || size <= 0) return chunks;
  const ov = overlap < 0 ? 0 : overlap;
  const effOverlap = ov >= size ? size - 1 : ov;
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    const nextStart = end - effOverlap;
    start = nextStart <= start ? end : nextStart;
  }
  return chunks;
}

function extractStreamDelta(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (Array.isArray(obj.choices) && obj.choices.length) {
    const choice = obj.choices[0];
    if (choice?.delta?.content) return String(choice.delta.content);
    if (choice?.message?.content) return String(choice.message.content);
  }
  if (typeof obj.delta === 'string') return obj.delta;
  if (obj.response && Array.isArray(obj.response.output) && obj.response.output.length) {
    const first = obj.response.output[0];
    if (first && Array.isArray(first.content) && first.content.length) {
      const content = first.content[0];
      if (typeof content?.text === 'string') return content.text;
      if (content?.text?.value) return String(content.text.value);
    }
  }
  return '';
}

export function parseStreamingBody(bodyText, headers = {}) {
  const result = { assembled: '', events: 0 };
  if (!bodyText || typeof bodyText !== 'string') return result;

  const contentType = typeof headers['content-type'] === 'string'
    ? headers['content-type'].toLowerCase()
    : '';
  const looksLikeSse = contentType.includes('text/event-stream') || bodyText.includes('data:');
  if (!looksLikeSse) return result;

  const matches = bodyText.matchAll(/^data:\s*(.+)$/gm);
  for (const m of matches) {
    const payload = (m[1] || '').trim();
    if (!payload || payload === '[DONE]') continue;
    const parsed = safeJsonParse(payload);
    if (!parsed) continue;
    const delta = extractStreamDelta(parsed);
    if (!delta) continue;
    result.assembled += delta;
    result.events += 1;
  }

  return result;
}

export function buildStreamMessageBody(text) {
  return JSON.stringify({ message: { content: text } });
}
