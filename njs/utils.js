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

export const CONFIG_HOST_DEFAULT = '__default__';

export function normalizeHostName(value) {
  const trimmed = value === undefined || value === null ? '' : String(value).trim();
  if (!trimmed) return CONFIG_HOST_DEFAULT;
  return trimmed.toLowerCase();
}

function readHostsArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map(item => String(item));
  }
  const parsed = safeJsonParse(raw);
  if (Array.isArray(parsed)) {
    return parsed.map(item => String(item));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/\s*,\s*/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function writeHostsVariable(r, hosts) {
  const seen = {};
  const normalized = [];
  for (let i = 0; i < hosts.length; i++) {
    const host = normalizeHostName(hosts[i]);
    if (!host || seen[host]) continue;
    seen[host] = true;
    normalized.push(host);
  }
  if (!seen[CONFIG_HOST_DEFAULT]) {
    normalized.unshift(CONFIG_HOST_DEFAULT);
  }
  try {
    r.variables.scan_config_hosts = JSON.stringify(normalized);
    return undefined;
  } catch (err) {
    return String(err);
  }
}

export function readConfigHosts(r) {
  const raw = readVar(r, 'scan_config_hosts', '[]');
  const items = readHostsArray(raw);
  const seen = {};
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const host = normalizeHostName(items[i]);
    if (!host || seen[host]) continue;
    seen[host] = true;
    out.push(host);
  }
  if (!seen[CONFIG_HOST_DEFAULT]) {
    out.unshift(CONFIG_HOST_DEFAULT);
  }
  return out;
}

export function ensureHostInConfig(r, host) {
  const target = normalizeHostName(host);
  const hosts = readConfigHosts(r);
  if (hosts.indexOf(target) !== -1) {
    return { added: false, hosts };
  }
  hosts.push(target);
  const error = writeHostsVariable(r, hosts);
  if (error) {
    return { added: false, error };
  }
  return { added: true, hosts };
}

export function removeHostFromConfig(r, host) {
  const target = normalizeHostName(host);
  if (target === CONFIG_HOST_DEFAULT) {
    return { removed: false, hosts: readConfigHosts(r) };
  }
  const current = readConfigHosts(r);
  const filtered = [];
  const seen = {};
  for (let i = 0; i < current.length; i++) {
    const normalized = normalizeHostName(current[i]);
    if (!normalized || normalized === target) continue;
    if (seen[normalized]) continue;
    seen[normalized] = true;
    filtered.push(normalized);
  }
  if (!filtered.length) {
    filtered.push(CONFIG_HOST_DEFAULT);
  }
  const error = writeHostsVariable(r, filtered);
  if (error) {
    return { removed: false, error };
  }
  return { removed: true, hosts: filtered };
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

export const SCAN_CONFIG_DEFAULTS = {
  inspectMode: 'both',
  redactMode: 'both',
  logLevel: 'info',
  requestPaths: ['.messages[-1].content'],
  responsePaths: ['.message.content'],
  requestForwardMode: 'sequential',
  requestExtractor: '',
  responseExtractor: '',
  requestExtractors: [],
  responseExtractors: [],
  extractorParallel: false
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

function parseExtractorList(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') {
    return Array.isArray(fallback) ? fallback.slice() : [];
  }
  let parsed;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return Array.isArray(fallback) ? fallback.slice() : [];
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      return [trimmed];
    }
  } else {
    parsed = raw;
  }

  if (Array.isArray(parsed)) {
    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (item === undefined || item === null) continue;
      const str = String(item).trim();
      if (str) out.push(str);
    }
    return out;
  }

  if (typeof parsed === 'string') {
    const str = parsed.trim();
    return str ? [str] : Array.isArray(fallback) ? fallback.slice() : [];
  }

  return Array.isArray(fallback) ? fallback.slice() : [];
}

function normalizeBooleanFlag(value, fallback) {
  if (value === undefined || value === null) return !!fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false;
  return !!fallback;
}

function normalizeExtractorInput(input, fallback) {
  if (input === undefined || input === null) {
    return { values: Array.isArray(fallback) ? fallback.slice() : [], error: null };
  }
  if (Array.isArray(input)) {
    const out = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      if (item === undefined || item === null) continue;
      const str = String(item).trim();
      if (!str) continue;
      if (out.indexOf(str) === -1) out.push(str);
    }
    return { values: out, error: null };
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return { values: [], error: null };
    if (trimmed[0] === '[') {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeExtractorInput(parsed, fallback);
      } catch (_) {
        return { values: [trimmed], error: null };
      }
    }
    if (trimmed.indexOf(',') !== -1) {
      return normalizeExtractorInput(trimmed.split(','), fallback);
    }
    return { values: [trimmed], error: null };
  }
  return { values: [], error: 'extractor identifiers must be strings' };
}

function coerceOptionalBoolean(value, fieldName) {
  if (value === undefined || value === null) {
    return { value: undefined, error: null };
  }
  if (typeof value === 'boolean') {
    return { value, error: null };
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return { value: true, error: null };
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return { value: false, error: null };
  }
  return { value: undefined, error: (fieldName || 'value') + ' must be a boolean-like string or boolean.' };
}

export function readScanConfig(r) {
  const inspectDefault = normalizeEnum(
    readVariable(r, 'scan_config_default_inspect_mode'),
    SCAN_CONFIG_ENUMS.inspectMode,
    SCAN_CONFIG_DEFAULTS.inspectMode
  );
  const redactDefault = normalizeEnum(
    readVariable(r, 'scan_config_default_redact_mode'),
    SCAN_CONFIG_ENUMS.redactMode,
    SCAN_CONFIG_DEFAULTS.redactMode,
    { on: 'both', true: 'both' }
  );
  const logDefault = normalizeEnum(
    readVariable(r, 'scan_config_default_log_level'),
    SCAN_CONFIG_ENUMS.logLevel,
    SCAN_CONFIG_DEFAULTS.logLevel
  );
  const requestPathsDefault = parsePathsVariable(
    readVariable(r, 'scan_config_default_request_paths'),
    SCAN_CONFIG_DEFAULTS.requestPaths
  );
  const responsePathsDefault = parsePathsVariable(
    readVariable(r, 'scan_config_default_response_paths'),
    SCAN_CONFIG_DEFAULTS.responsePaths
  );
  const forwardDefault = normalizeEnum(
    readVariable(r, 'scan_config_default_request_forward_mode'),
    SCAN_CONFIG_ENUMS.requestForwardMode,
    SCAN_CONFIG_DEFAULTS.requestForwardMode
  );
  const requestExtractorDefaultList = parseExtractorList(
    readVariable(r, 'scan_config_default_request_extractor'),
    SCAN_CONFIG_DEFAULTS.requestExtractors.length
      ? SCAN_CONFIG_DEFAULTS.requestExtractors
      : (SCAN_CONFIG_DEFAULTS.requestExtractor ? [SCAN_CONFIG_DEFAULTS.requestExtractor] : [])
  );
  const responseExtractorDefaultList = parseExtractorList(
    readVariable(r, 'scan_config_default_response_extractor'),
    SCAN_CONFIG_DEFAULTS.responseExtractors.length
      ? SCAN_CONFIG_DEFAULTS.responseExtractors
      : (SCAN_CONFIG_DEFAULTS.responseExtractor ? [SCAN_CONFIG_DEFAULTS.responseExtractor] : [])
  );
  const extractorParallelDefault = normalizeBooleanFlag(
    readVariable(r, 'scan_config_default_extractor_parallel'),
    SCAN_CONFIG_DEFAULTS.extractorParallel
  );

  const requestExtractors = parseExtractorList(
    readVariable(r, 'scan_config_request_extractor'),
    requestExtractorDefaultList
  );
  const responseExtractors = parseExtractorList(
    readVariable(r, 'scan_config_response_extractor'),
    responseExtractorDefaultList
  );
  const extractorParallel = normalizeBooleanFlag(
    (() => {
      const raw = readVariable(r, 'scan_config_extractor_parallel');
      return raw === undefined ? extractorParallelDefault : raw;
    })(),
    extractorParallelDefault
  );

  return {
    inspectMode: normalizeEnum(
      readVariable(r, 'scan_config_inspect_mode', inspectDefault),
      SCAN_CONFIG_ENUMS.inspectMode,
      inspectDefault
    ),
    redactMode: normalizeEnum(
      readVariable(r, 'scan_config_redact_mode', redactDefault),
      SCAN_CONFIG_ENUMS.redactMode,
      redactDefault,
      { on: 'both', true: 'both' }
    ),
    logLevel: normalizeEnum(
      readVariable(r, 'scan_config_log_level', logDefault),
      SCAN_CONFIG_ENUMS.logLevel,
      logDefault
    ),
    requestPaths: parsePathsVariable(
      readVariable(r, 'scan_config_request_paths'),
      requestPathsDefault
    ),
    responsePaths: parsePathsVariable(
      readVariable(r, 'scan_config_response_paths'),
      responsePathsDefault
    ),
    requestForwardMode: normalizeEnum(
      readVariable(r, 'scan_config_request_forward_mode', forwardDefault),
      SCAN_CONFIG_ENUMS.requestForwardMode,
      forwardDefault
    ),
    requestExtractor: requestExtractors.length ? requestExtractors[0] : '',
    responseExtractor: responseExtractors.length ? responseExtractors[0] : '',
    requestExtractors,
    responseExtractors,
    extractorParallelEnabled: extractorParallel
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

  const requestExtractorInput =
    patch.requestExtractors !== undefined ? patch.requestExtractors
    : (patch.requestExtractor !== undefined ? patch.requestExtractor : undefined);
  if (requestExtractorInput !== undefined) {
    const normalized = normalizeExtractorInput(requestExtractorInput, []);
    if (normalized.error) {
      errors.push('requestExtractors: ' + normalized.error);
    } else {
      updates.requestExtractors = normalized.values;
    }
  }

  const responseExtractorInput =
    patch.responseExtractors !== undefined ? patch.responseExtractors
    : (patch.responseExtractor !== undefined ? patch.responseExtractor : undefined);
  if (responseExtractorInput !== undefined) {
    const normalized = normalizeExtractorInput(responseExtractorInput, []);
    if (normalized.error) {
      errors.push('responseExtractors: ' + normalized.error);
    } else {
      updates.responseExtractors = normalized.values;
    }
  }

  const parallelInput =
    patch.extractorParallelEnabled !== undefined ? patch.extractorParallelEnabled
    : (patch.extractorParallel !== undefined ? patch.extractorParallel
      : (patch.parallelExtractorsEnabled !== undefined ? patch.parallelExtractorsEnabled
        : patch.parallelExtractors));
  if (parallelInput !== undefined) {
    const coerced = coerceOptionalBoolean(parallelInput, 'extractorParallelEnabled');
    if (coerced.error) {
      errors.push(coerced.error);
    } else if (coerced.value !== undefined) {
      updates.extractorParallel = coerced.value;
    }
  }

  return { errors, updates };
}

export function applyConfigPatch(r, updates, host) {
  const applied = {};
  if (!updates || typeof updates !== 'object') return applied;

  if (updates.requestExtractor !== undefined && updates.requestExtractors === undefined) {
    updates.requestExtractors = updates.requestExtractor ? [updates.requestExtractor] : [];
  }
  if (updates.responseExtractor !== undefined && updates.responseExtractors === undefined) {
    updates.responseExtractors = updates.responseExtractor ? [updates.responseExtractor] : [];
  }

  const targetHost = normalizeHostName(host);
  applied.host = targetHost;

  const ensure = ensureHostInConfig(r, targetHost);
  if (ensure && ensure.error) {
    applied.hostError = ensure.error;
  }

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

  if (updates.requestExtractors !== undefined) {
    try {
      r.variables.scan_config_request_extractor = JSON.stringify(updates.requestExtractors);
      applied.requestExtractors = updates.requestExtractors;
      applied.requestExtractor = updates.requestExtractors.length ? updates.requestExtractors[0] : '';
    } catch (err) {
      applied.requestExtractorsError = String(err);
    }
  }

  if (updates.responseExtractors !== undefined) {
    try {
      r.variables.scan_config_response_extractor = JSON.stringify(updates.responseExtractors);
      applied.responseExtractors = updates.responseExtractors;
      applied.responseExtractor = updates.responseExtractors.length ? updates.responseExtractors[0] : '';
    } catch (err) {
      applied.responseExtractorsError = String(err);
    }
  }

  if (updates.extractorParallel !== undefined) {
    try {
      r.variables.scan_config_extractor_parallel = updates.extractorParallel ? '1' : '0';
      applied.extractorParallel = !!updates.extractorParallel;
    } catch (err) {
      applied.extractorParallelError = String(err);
    }
  }

  return applied;
}

export function clearHostConfig(r, host) {
  const targetHost = normalizeHostName(host);
  const result = { host: targetHost };
  const keys = [
    'scan_config_inspect_mode',
    'scan_config_redact_mode',
    'scan_config_log_level',
    'scan_config_request_paths',
    'scan_config_response_paths',
    'scan_config_request_forward_mode',
    'scan_config_request_extractor',
    'scan_config_response_extractor',
    'scan_config_extractor_parallel'
  ];
  const errors = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      r.variables[key] = '';
    } catch (err) {
      errors.push(String(err));
    }
  }
  if (errors.length) {
    result.errors = errors;
  }
  return result;
}
