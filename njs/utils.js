// /etc/nginx/njs/utils.js

// --- Minimal JSON safe stringify
export function safeJson(v) {
  try { return JSON.stringify(v); } catch (_) { return '[unserializable]'; }
}

// Defensive JSON.parse wrapper for untrusted payloads
export function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}

// Shell out nginx variable reads with sane fallbacks
export function readVar(r, name, fallback) {
  try {
    const vars = r && r.variables;
    if (!vars || vars[name] === undefined || vars[name] === null || vars[name] === '') {
      return fallback;
    }
    return vars[name];
  } catch (_) {
    return fallback;
  }
}

// Normalize inspection toggles like 'both', 'off', 'request', etc.
export function isModeEnabled(mode, target) {
  if (!mode) return false;
  const normalized = String(mode).toLowerCase();
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  if (normalized === 'both' || normalized === 'all' || normalized === 'on' || normalized === 'true') return true;
  return normalized === target;
}

// --- Lightweight, njs-friendly logger
// opts: { log: boolean | 'debug'|'info'|'warn'|'err', r?: <request> }
export function makeLogger(opts) {
  const enabled = !!(opts && opts.log); // boolean or string level
  const level   = (opts && typeof opts.log === 'string') ? opts.log : 'debug';
  const r       = opts && opts.r;

  const levels  = { debug: ngx.DEBUG, info: ngx.INFO, warn: ngx.WARN, err: ngx.ERR };

  function emit(msg, lvl) {
    if (!enabled) return;
    const lv = levels[lvl || level] || levels.debug;
    const s  = (typeof msg === 'string') ? msg : safeJson(msg);

    // r.log has no explicit level; treat as info+ to avoid ngx.DEBUG noise in prod
    if (r && r.log && lv !== ngx.DEBUG) {
      r.log(s);
    } else {
      ngx.log(lv, s);
    }
  }
  return emit;
}

function parseJsonPath(path) {
  if (!path || path[0] !== '.') {
    return undefined;
  }
  const re = /\.([A-Za-z0-9_]+)(?:\[(\-?\d+)\])?/g;
  const tokens = [];
  let match;
  let lastIndex = 0;

  while ((match = re.exec(path)) !== null) {
    const key = match[1];
    const idx = match[2] !== undefined ? parseInt(match[2], 10) : undefined;
    tokens.push({ key, index: idx });
    lastIndex = re.lastIndex;
  }

  if (!tokens.length || lastIndex !== path.length) {
    return undefined;
  }
  return tokens;
}

function resolveIndex(arr, idx) {
  if (!Array.isArray(arr)) return { ok: false };
  let resolved = idx;
  if (resolved === -1) resolved = arr.length - 1;
  if (resolved < 0 || resolved >= arr.length) return { ok: false };
  return { ok: true, index: resolved };
}

export function getPathAccessor(root, path, opts) {
  const log = makeLogger(opts);
  const tokens = parseJsonPath(path);
  if (!tokens) {
    log({ step: 'path:parse_error', path }, 'warn');
    return undefined;
  }

  let cur = root;
  let parent = null;
  let keyOrIndex = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (cur == null || typeof cur !== 'object' || !(token.key in cur)) {
      log({ step: 'path:missing_key', path, key: token.key }, 'warn');
      return undefined;
    }

    parent = cur;
    keyOrIndex = token.key;
    let next = parent[keyOrIndex];

    if (token.index !== undefined) {
      const resolved = resolveIndex(next, token.index);
      if (!resolved.ok) {
        log({ step: 'path:index_error', path, key: token.key, index: token.index }, 'warn');
        return undefined;
      }
      parent = next;
      keyOrIndex = resolved.index;
      next = parent[keyOrIndex];
    }

    cur = next;
  }

  if (parent === null) {
    log({ step: 'path:no_parent', path }, 'warn');
    return undefined;
  }

  return {
    value: cur,
    set(nextValue) {
      parent[keyOrIndex] = nextValue;
    }
  };
}

export function extractSegments(root, searches, delimiter, opts) {
  const log = makeLogger(opts);
  log('extractSegments: start', 'info');
  log({ root_type: typeof root, searches, delimiter });

  if (!root || !Array.isArray(searches)) {
    log('extractSegments: invalid inputs (returning empty string)', 'warn');
    return { text: '', segments: [] };
  }

  const segments = [];
  const delim = delimiter ?? '';
  let out = '';

  for (let i = 0; i < searches.length; i++) {
    const path = String(searches[i]);
    log({ step: 'iterate', i, path });

    const accessor = getPathAccessor(root, path, { log, r: opts && opts.r });
    let rawValue;

    if (!accessor) {
      log({ step: 'value_unresolved', path }, 'debug');
      rawValue = '';
    } else {
      rawValue = accessor.value;
    }

    let strValue = '';
    if (rawValue === undefined || rawValue === null) {
      strValue = '';
      log({ step: 'value_nullish', path }, 'debug');
    } else if (typeof rawValue === 'object') {
      strValue = safeJson(rawValue);
      log({ step: 'value_object_stringified', path, snippet: strValue.slice(0, 200) }, 'debug');
    } else {
      strValue = String(rawValue);
      log({ step: 'value_primitive', path, value: strValue }, 'debug');
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

  log({ step: 'extractSegments:end', length: out.length, preview: out.slice(0, 200) }, 'info');
  return { text: out, segments };
}

/**
 * extractJoin
 * Extracts values from an object using JSON-path-like selectors and joins them.
 *   root:      object to search
 *   searches:  array like ['.a.b', '.arr[-1].x']
 *   delimiter: appended between extracted values
 *   opts:      { log: boolean | level, r: <request> }
 */
export function extractJoin(root, searches, delimiter, opts) {
  const { text } = extractSegments(root, searches, delimiter, opts);
  return text;
}

export const SCAN_CONFIG_DEFAULTS = {
  inspectMode: 'both',
  redactMode: 'both',
  logLevel: 'info',
  requestPaths: ['.messages[-1].content'],
  responsePaths: ['.message.content'],
  requestForwardMode: 'sequential'
};

export const SCAN_CONFIG_ENUMS = {
  inspectMode: ['off', 'request', 'response', 'both'],
  redactMode: ['off', 'request', 'response', 'both'],
  logLevel: ['debug', 'info', 'warn', 'err'],
  requestForwardMode: ['sequential', 'parallel']
};

function normalizeEnum(value, allowed, fallback, alias) {
  if (typeof value !== 'string') return fallback;
  let normalized = value.toLowerCase();
  if (alias && alias[normalized]) {
    normalized = alias[normalized];
  }
  for (let i = 0; i < allowed.length; i++) {
    if (normalized === allowed[i]) {
      return normalized;
    }
  }
  return fallback;
}

function readVariable(r, name) {
  try {
    if (!r || !r.variables) return undefined;
    const val = r.variables[name];
    if (val === undefined || val === null || val === '') return undefined;
    return String(val);
  } catch (_) {
    return undefined;
  }
}

function normalizePathsInput(input, fallback) {
  if (Array.isArray(input)) {
    const trim = [];
    for (let i = 0; i < input.length; i++) {
      const value = input[i];
      if (value === undefined || value === null) continue;
      const str = String(value).trim();
      if (str) trim.push(str);
    }
    return trim.length ? trim : fallback;
  }
  if (typeof input === 'string') {
    const items = input
      .split(/\r?\n|,/)
      .map((part) => part.trim())
      .filter((part) => !!part);
    return items.length ? items : fallback;
  }
  return fallback;
}

function parsePathsVariable(text, fallback) {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    const normalized = normalizePathsInput(parsed, fallback);
    return normalized.length ? normalized : fallback;
  } catch (_) {
    return normalizePathsInput(text, fallback);
  }
}

export function readScanConfig(r) {
  return {
    inspectMode: normalizeEnum(
      readVariable(r, 'scan_config_inspect_mode'),
      SCAN_CONFIG_ENUMS.inspectMode,
      SCAN_CONFIG_DEFAULTS.inspectMode
    ),
    redactMode: normalizeEnum(
      readVariable(r, 'scan_config_redact_mode'),
      SCAN_CONFIG_ENUMS.redactMode,
      SCAN_CONFIG_DEFAULTS.redactMode,
      { on: 'both', true: 'both' }
    ),
    logLevel: normalizeEnum(
      readVariable(r, 'scan_config_log_level'),
      SCAN_CONFIG_ENUMS.logLevel,
      SCAN_CONFIG_DEFAULTS.logLevel
    ),
    requestPaths: parsePathsVariable(
      readVariable(r, 'scan_config_request_paths'),
      SCAN_CONFIG_DEFAULTS.requestPaths
    ),
    responsePaths: parsePathsVariable(
      readVariable(r, 'scan_config_response_paths'),
      SCAN_CONFIG_DEFAULTS.responsePaths
    ),
    requestForwardMode: normalizeEnum(
      readVariable(r, 'scan_config_request_forward_mode'),
      SCAN_CONFIG_ENUMS.requestForwardMode,
      SCAN_CONFIG_DEFAULTS.requestForwardMode
    )
  };
}

export function validateConfigPatch(patch) {
  const errors = [];
  const updates = {};

  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { errors: ['payload must be a JSON object'], updates };
  }

  if (patch.inspectMode !== undefined) {
    const mode = normalizeEnum(
      String(patch.inspectMode),
      SCAN_CONFIG_ENUMS.inspectMode,
      undefined
    );
    if (!mode) {
      errors.push('inspectMode must be one of: ' + SCAN_CONFIG_ENUMS.inspectMode.join(', '));
    } else {
      updates.inspectMode = mode;
    }
  }

  if (patch.redactMode !== undefined) {
    const mode = normalizeEnum(
      String(patch.redactMode),
      SCAN_CONFIG_ENUMS.redactMode,
      undefined,
      { on: 'both', true: 'both' }
    );
    if (!mode) {
      errors.push('redactMode must be one of: ' + SCAN_CONFIG_ENUMS.redactMode.join(', '));
    } else {
      updates.redactMode = mode;
    }
  }

  if (patch.logLevel !== undefined) {
    const level = normalizeEnum(
      String(patch.logLevel),
      SCAN_CONFIG_ENUMS.logLevel,
      undefined
    );
    if (!level) {
      errors.push('logLevel must be one of: ' + SCAN_CONFIG_ENUMS.logLevel.join(', '));
    } else {
      updates.logLevel = level;
    }
  }

  if (patch.requestPaths !== undefined) {
    const normalized = normalizePathsInput(patch.requestPaths, []);
    if (!normalized.length) {
      errors.push('requestPaths must contain at least one JSON path string.');
    } else {
      updates.requestPaths = normalized;
    }
  }

  if (patch.responsePaths !== undefined) {
    const normalized = normalizePathsInput(patch.responsePaths, []);
    if (!normalized.length) {
      errors.push('responsePaths must contain at least one JSON path string.');
    } else {
      updates.responsePaths = normalized;
    }
  }

  if (patch.requestForwardMode !== undefined) {
    const mode = normalizeEnum(
      String(patch.requestForwardMode),
      SCAN_CONFIG_ENUMS.requestForwardMode,
      undefined
    );
    if (!mode) {
      errors.push('requestForwardMode must be one of: ' + SCAN_CONFIG_ENUMS.requestForwardMode.join(', '));
    } else {
      updates.requestForwardMode = mode;
    }
  }

  return { errors, updates };
}

export function applyConfigPatch(r, updates) {
  const applied = {};
  if (!updates || typeof updates !== 'object') return applied;

  if (updates.inspectMode !== undefined) {
    try {
      r.variables.scan_config_inspect_mode = updates.inspectMode;
      applied.inspectMode = updates.inspectMode;
    } catch (err) {
      applied.inspectModeError = String(err);
    }
  }

  if (updates.redactMode !== undefined) {
    try {
      r.variables.scan_config_redact_mode = updates.redactMode;
      applied.redactMode = updates.redactMode;
    } catch (err) {
      applied.redactModeError = String(err);
    }
  }

  if (updates.logLevel !== undefined) {
    try {
      r.variables.scan_config_log_level = updates.logLevel;
      applied.logLevel = updates.logLevel;
    } catch (err) {
      applied.logLevelError = String(err);
    }
  }

  if (updates.requestPaths !== undefined) {
    try {
      r.variables.scan_config_request_paths = JSON.stringify(updates.requestPaths);
      applied.requestPaths = updates.requestPaths;
    } catch (err) {
      applied.requestPathsError = String(err);
    }
  }

  if (updates.responsePaths !== undefined) {
    try {
      r.variables.scan_config_response_paths = JSON.stringify(updates.responsePaths);
      applied.responsePaths = updates.responsePaths;
    } catch (err) {
      applied.responsePathsError = String(err);
    }
  }

  if (updates.requestForwardMode !== undefined) {
    try {
      r.variables.scan_config_request_forward_mode = updates.requestForwardMode;
      applied.requestForwardMode = updates.requestForwardMode;
    } catch (err) {
      applied.requestForwardModeError = String(err);
    }
  }

  return applied;
}
