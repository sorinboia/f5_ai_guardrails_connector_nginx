// /etc/nginx/njs/utils.js

// --- Minimal JSON safe stringify
export function safeJson(v) {
  try { return JSON.stringify(v); } catch (_) { return '[unserializable]'; }
}

// Defensive JSON.parse wrapper for untrusted payloads
export function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}

// Shared dictionary plumbing (QuickJS njs)
const SHARED_DICT_NAME = 'guardrails_config';
const SHARED_KEYS = {
  hosts: 'config:hosts',
  hostPrefix: 'config:host:',
  apiKeys: 'config:api_keys',
  patterns: 'config:patterns',
  collectorEntries: 'collector:entries',
  collectorTotal: 'collector:total',
  collectorRemaining: 'collector:remaining'
};

function cloneJsonValue(value) {
  if (value === undefined || value === null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function getSharedDict() {
  try {
    return ngx.shared ? ngx.shared[SHARED_DICT_NAME] : undefined;
  } catch (_) {
    return undefined;
  }
}

export function readSharedJson(key, fallback) {
  const dict = getSharedDict();
  if (!dict) return cloneJsonValue(fallback);
  try {
    const raw = dict.get(key);
    if (raw === undefined || raw === null) return cloneJsonValue(fallback);
    if (typeof raw === 'string') {
      const parsed = safeJsonParse(raw);
      if (parsed !== undefined) return parsed;
    }
    if (typeof raw === 'object') return cloneJsonValue(raw);
    return cloneJsonValue(fallback);
  } catch (_) {
    return cloneJsonValue(fallback);
  }
}

export function writeSharedJson(key, value, opts) {
  const log = makeLogger(opts);
  const dict = getSharedDict();
  if (!dict) {
    if (log) log({ step: 'shared_dict:missing', dict: SHARED_DICT_NAME }, 'err');
    return { ok: false, error: `shared dict ${SHARED_DICT_NAME} is not configured` };
  }
  try {
    dict.set(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    if (log) log({ step: 'shared_dict:write_failed', key, error: String(err) }, 'err');
    return { ok: false, error: String(err) };
  }
}

export function readSharedNumber(key, fallback) {
  const dict = getSharedDict();
  if (!dict) return fallback;
  try {
    const raw = dict.get(key);
    if (raw === undefined || raw === null) return fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
  } catch (_) {
    return fallback;
  }
}

export function writeSharedNumber(key, value, opts) {
  const log = makeLogger(opts);
  const dict = getSharedDict();
  if (!dict) {
    if (log) log({ step: 'shared_dict:missing', dict: SHARED_DICT_NAME }, 'err');
    return { ok: false, error: `shared dict ${SHARED_DICT_NAME} is not configured` };
  }
  try {
    // js_shared_dict defaults to type=string; stringify numbers to avoid TypeError
    dict.set(key, String(value));
    return { ok: true };
  } catch (err) {
    if (log) log({ step: 'shared_dict:write_failed', key, error: String(err) }, 'err');
    return { ok: false, error: String(err) };
  }
}

export function deleteSharedKey(key, opts) {
  const log = makeLogger(opts);
  const dict = getSharedDict();
  if (!dict) {
    if (log) log({ step: 'shared_dict:missing', dict: SHARED_DICT_NAME }, 'err');
    return { ok: false, error: `shared dict ${SHARED_DICT_NAME} is not configured` };
  }
  try {
    dict.delete(key);
    return { ok: true };
  } catch (err) {
    if (log) log({ step: 'shared_dict:delete_failed', key, error: String(err) }, 'err');
    return { ok: false, error: String(err) };
  }
}

function toNumber(value) {
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return num;
}

export function clampInteger(value, fallback, min, max) {
  const num = toNumber(value);
  if (num === undefined) return fallback;
  const clamped = Math.trunc(num);
  if (min !== undefined && clamped < min) return min;
  if (max !== undefined && clamped > max) return max;
  return clamped;
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
const CONFIG_HOST_HEADER = 'x-guardrails-config-host';

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

function writeHostsShared(hosts, opts) {
  const log = makeLogger(opts);
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
  const res = writeSharedJson(SHARED_KEYS.hosts, normalized, { log: 'err', r: opts && opts.r });
  return res.ok ? undefined : res.error;
}

function hostKey(host) {
  return SHARED_KEYS.hostPrefix + normalizeHostName(host);
}

export function readConfigHosts(r) {
  const rawHosts = readSharedJson(SHARED_KEYS.hosts, []);
  const items = readHostsArray(rawHosts);
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
  const error = writeHostsShared(hosts, { r });
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
  const error = writeHostsShared(filtered, { r });
  if (error) {
    return { removed: false, error };
  }
  deleteSharedKey(hostKey(target), { r });
  return { removed: true, hosts: filtered };
}

function readHostConfig(host) {
  const cfg = readSharedJson(hostKey(host), {});
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
  return cfg;
}

function writeHostConfig(host, config, opts) {
  return writeSharedJson(hostKey(host), config, opts);
}

function resolveHeaderHost(r) {
  const header = r && r.headersIn ? r.headersIn[CONFIG_HOST_HEADER] : undefined;
  return normalizeHostName(header);
}

function resolveHttpHost(r) {
  const headerHost = r && r.headersIn ? r.headersIn.host : '';
  if (headerHost) return normalizeHostName(headerHost);
  const varHost = readVar(r, 'http_host', '');
  return normalizeHostName(varHost);
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
  requestForwardMode: 'sequential',
  backendOrigin: 'https://api.openai.com',
  requestExtractor: '',
  responseExtractor: '',
  requestExtractors: [],
  responseExtractors: [],
  extractorParallel: false,
  responseStreamEnabled: true,
  responseStreamChunkSize: 2048,
  responseStreamChunkOverlap: 128,
  responseStreamFinalEnabled: true,
  responseStreamCollectFullEnabled: false
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

export function resolveConfigHost(r, hostOverride) {
  if (hostOverride !== undefined && hostOverride !== null && hostOverride !== '') {
    return normalizeHostName(hostOverride);
  }
  const headerHost = resolveHeaderHost(r);
  if (headerHost && headerHost !== CONFIG_HOST_DEFAULT) {
    return headerHost;
  }
  const httpHost = resolveHttpHost(r);
  return httpHost || CONFIG_HOST_DEFAULT;
}

export function readScanConfig(r, hostOverride, opts) {
  const ensure = !opts || opts.ensure !== false;
  const targetHost = resolveConfigHost(r, hostOverride);
  if (ensure) {
    ensureHostInConfig(r, targetHost);
  }

  const defaultCfg = readHostConfig(CONFIG_HOST_DEFAULT);
  const hostCfg = targetHost === CONFIG_HOST_DEFAULT ? defaultCfg : readHostConfig(targetHost);

  const inspectDefault = normalizeEnum(
    defaultCfg.inspectMode,
    SCAN_CONFIG_ENUMS.inspectMode,
    SCAN_CONFIG_DEFAULTS.inspectMode
  );
  const redactDefault = normalizeEnum(
    defaultCfg.redactMode,
    SCAN_CONFIG_ENUMS.redactMode,
    SCAN_CONFIG_DEFAULTS.redactMode,
    { on: 'both', true: 'both' }
  );
  const logDefault = normalizeEnum(
    defaultCfg.logLevel,
    SCAN_CONFIG_ENUMS.logLevel,
    SCAN_CONFIG_DEFAULTS.logLevel
  );
  const forwardDefault = normalizeEnum(
    defaultCfg.requestForwardMode,
    SCAN_CONFIG_ENUMS.requestForwardMode,
    SCAN_CONFIG_DEFAULTS.requestForwardMode
  );

  const backendDefaultRaw = defaultCfg.backendOrigin;
  const backendDefault = backendDefaultRaw && typeof backendDefaultRaw === 'string' && backendDefaultRaw.trim()
    ? backendDefaultRaw.trim()
    : SCAN_CONFIG_DEFAULTS.backendOrigin;

  const requestExtractorDefaultList = parseExtractorList(
    defaultCfg.requestExtractors !== undefined ? defaultCfg.requestExtractors : defaultCfg.requestExtractor,
    SCAN_CONFIG_DEFAULTS.requestExtractors.length
      ? SCAN_CONFIG_DEFAULTS.requestExtractors
      : (SCAN_CONFIG_DEFAULTS.requestExtractor ? [SCAN_CONFIG_DEFAULTS.requestExtractor] : [])
  );
  const responseExtractorDefaultList = parseExtractorList(
    defaultCfg.responseExtractors !== undefined ? defaultCfg.responseExtractors : defaultCfg.responseExtractor,
    SCAN_CONFIG_DEFAULTS.responseExtractors.length
      ? SCAN_CONFIG_DEFAULTS.responseExtractors
      : (SCAN_CONFIG_DEFAULTS.responseExtractor ? [SCAN_CONFIG_DEFAULTS.responseExtractor] : [])
  );

  const extractorParallelDefault = normalizeBooleanFlag(
    defaultCfg.extractorParallel !== undefined ? defaultCfg.extractorParallel : defaultCfg.extractorParallelEnabled,
    SCAN_CONFIG_DEFAULTS.extractorParallel
  );
  const responseStreamDefaultEnabled = normalizeBooleanFlag(
    defaultCfg.responseStreamEnabled,
    SCAN_CONFIG_DEFAULTS.responseStreamEnabled
  );
  const responseStreamDefaultChunkSize = clampInteger(
    defaultCfg.responseStreamChunkSize,
    SCAN_CONFIG_DEFAULTS.responseStreamChunkSize,
    128,
    65536
  );
  const responseStreamDefaultChunkOverlap = clampInteger(
    defaultCfg.responseStreamChunkOverlap,
    SCAN_CONFIG_DEFAULTS.responseStreamChunkOverlap,
    0,
    responseStreamDefaultChunkSize - 1
  );
  const responseStreamDefaultFinal = normalizeBooleanFlag(
    defaultCfg.responseStreamFinalEnabled,
    SCAN_CONFIG_DEFAULTS.responseStreamFinalEnabled
  );
  const responseStreamDefaultCollectFull = normalizeBooleanFlag(
    defaultCfg.responseStreamCollectFullEnabled,
    SCAN_CONFIG_DEFAULTS.responseStreamCollectFullEnabled
  );

  const requestExtractors = parseExtractorList(
    hostCfg.requestExtractors !== undefined ? hostCfg.requestExtractors : hostCfg.requestExtractor,
    requestExtractorDefaultList
  );
  const responseExtractors = parseExtractorList(
    hostCfg.responseExtractors !== undefined ? hostCfg.responseExtractors : hostCfg.responseExtractor,
    responseExtractorDefaultList
  );
  const extractorParallel = normalizeBooleanFlag(
    hostCfg.extractorParallel !== undefined ? hostCfg.extractorParallel : hostCfg.extractorParallelEnabled,
    extractorParallelDefault
  );
  const responseStreamEnabled = normalizeBooleanFlag(
    hostCfg.responseStreamEnabled,
    responseStreamDefaultEnabled
  );
  const responseStreamChunkSize = clampInteger(
    hostCfg.responseStreamChunkSize,
    responseStreamDefaultChunkSize,
    128,
    65536
  );
  const responseStreamChunkOverlap = clampInteger(
    hostCfg.responseStreamChunkOverlap,
    responseStreamDefaultChunkOverlap,
    0,
    responseStreamChunkSize - 1
  );
  const responseStreamFinalEnabled = normalizeBooleanFlag(
    hostCfg.responseStreamFinalEnabled,
    responseStreamDefaultFinal
  );
  const responseStreamCollectFullEnabled = normalizeBooleanFlag(
    hostCfg.responseStreamCollectFullEnabled,
    responseStreamDefaultCollectFull
  );

  const backendOriginRaw = hostCfg.backendOrigin;
  const backendOrigin = backendOriginRaw && typeof backendOriginRaw === 'string' && backendOriginRaw.trim()
    ? backendOriginRaw.trim()
    : backendDefault;

  return {
    host: targetHost,
    inspectMode: normalizeEnum(
      hostCfg.inspectMode,
      SCAN_CONFIG_ENUMS.inspectMode,
      inspectDefault
    ),
    redactMode: normalizeEnum(
      hostCfg.redactMode,
      SCAN_CONFIG_ENUMS.redactMode,
      redactDefault,
      { on: 'both', true: 'both' }
    ),
    logLevel: normalizeEnum(
      hostCfg.logLevel,
      SCAN_CONFIG_ENUMS.logLevel,
      logDefault
    ),
    requestForwardMode: normalizeEnum(
      hostCfg.requestForwardMode,
      SCAN_CONFIG_ENUMS.requestForwardMode,
      forwardDefault
    ),
    backendOrigin,
    requestExtractor: requestExtractors.length ? requestExtractors[0] : '',
    responseExtractor: responseExtractors.length ? responseExtractors[0] : '',
    requestExtractors,
    responseExtractors,
    extractorParallelEnabled: extractorParallel,
    responseStreamEnabled,
    responseStreamChunkSize,
    responseStreamChunkOverlap,
    responseStreamFinalEnabled,
    responseStreamCollectFullEnabled
  };
}

// Exposed for js_set to feed proxy_pass
export function backendOriginVar(r) {
  const cfg = readScanConfig(r);
  if (cfg && typeof cfg.backendOrigin === 'string' && cfg.backendOrigin.trim()) {
    return cfg.backendOrigin.trim();
  }
  return SCAN_CONFIG_DEFAULTS.backendOrigin;
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
    errors.push('requestPaths is no longer supported.');
  }

  if (patch.responsePaths !== undefined) {
    errors.push('responsePaths is no longer supported.');
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

  if (patch.backendOrigin !== undefined) {
    if (typeof patch.backendOrigin !== 'string' || !patch.backendOrigin.trim()) {
      errors.push('backendOrigin must be a non-empty string');
    } else {
      const trimmed = patch.backendOrigin.trim();
      if (!/^https?:\/\//i.test(trimmed)) {
        errors.push('backendOrigin must start with http:// or https://');
      } else {
        updates.backendOrigin = trimmed;
      }
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

  if (patch.responseStreamEnabled !== undefined) {
    const coerced = coerceOptionalBoolean(patch.responseStreamEnabled, 'responseStreamEnabled');
    if (coerced.error) {
      errors.push(coerced.error);
    } else if (coerced.value !== undefined) {
      updates.responseStreamEnabled = coerced.value;
    }
  }

  if (patch.responseStreamChunkSize !== undefined) {
    const num = clampInteger(patch.responseStreamChunkSize, undefined, 128, 65536);
    if (num === undefined) {
      errors.push('responseStreamChunkSize must be an integer between 128 and 65536');
    } else {
      updates.responseStreamChunkSize = num;
    }
  }

  if (patch.responseStreamChunkOverlap !== undefined) {
    const num = clampInteger(patch.responseStreamChunkOverlap, undefined, 0, 65535);
    if (num === undefined) {
      errors.push('responseStreamChunkOverlap must be a non-negative integer');
    } else {
      updates.responseStreamChunkOverlap = num;
    }
  }

  if (patch.responseStreamFinalEnabled !== undefined) {
    const coerced = coerceOptionalBoolean(patch.responseStreamFinalEnabled, 'responseStreamFinalEnabled');
    if (coerced.error) {
      errors.push(coerced.error);
    } else if (coerced.value !== undefined) {
      updates.responseStreamFinalEnabled = coerced.value;
    }
  }

  if (patch.responseStreamCollectFullEnabled !== undefined) {
    const coerced = coerceOptionalBoolean(patch.responseStreamCollectFullEnabled, 'responseStreamCollectFullEnabled');
    if (coerced.error) {
      errors.push(coerced.error);
    } else if (coerced.value !== undefined) {
      updates.responseStreamCollectFullEnabled = coerced.value;
    }
  }

  return { errors, updates };
}

export function applyConfigPatch(r, updates, host) {
  const applied = {};
  if (!updates || typeof updates !== 'object') return applied;

  const targetHost = normalizeHostName(host);
  applied.host = targetHost;

  const ensure = ensureHostInConfig(r, targetHost);
  if (ensure && ensure.error) {
    applied.hostError = ensure.error;
  }

  const current = readHostConfig(targetHost);
  const next = (current && typeof current === 'object' && !Array.isArray(current)) ? { ...current } : {};

  function setField(field, value, errorKey) {
    try {
      next[field] = value;
      applied[field] = value;
    } catch (err) {
      applied[errorKey] = String(err);
    }
  }

  if (updates.requestExtractor !== undefined && updates.requestExtractors === undefined) {
    updates.requestExtractors = updates.requestExtractor ? [updates.requestExtractor] : [];
  }
  if (updates.responseExtractor !== undefined && updates.responseExtractors === undefined) {
    updates.responseExtractors = updates.responseExtractor ? [updates.responseExtractor] : [];
  }

  if (updates.inspectMode !== undefined) setField('inspectMode', updates.inspectMode, 'inspectModeError');
  if (updates.redactMode !== undefined) setField('redactMode', updates.redactMode, 'redactModeError');
  if (updates.logLevel !== undefined) setField('logLevel', updates.logLevel, 'logLevelError');
  if (updates.requestForwardMode !== undefined) setField('requestForwardMode', updates.requestForwardMode, 'requestForwardModeError');
  if (updates.backendOrigin !== undefined) setField('backendOrigin', updates.backendOrigin, 'backendOriginError');
  if (updates.requestExtractors !== undefined) {
    const list = Array.isArray(updates.requestExtractors) ? updates.requestExtractors.slice() : [];
    setField('requestExtractors', list, 'requestExtractorsError');
    applied.requestExtractor = list.length ? list[0] : '';
  }
  if (updates.responseExtractors !== undefined) {
    const list = Array.isArray(updates.responseExtractors) ? updates.responseExtractors.slice() : [];
    setField('responseExtractors', list, 'responseExtractorsError');
    applied.responseExtractor = list.length ? list[0] : '';
  }
  if (updates.extractorParallel !== undefined) setField('extractorParallel', !!updates.extractorParallel, 'extractorParallelError');
  if (updates.responseStreamEnabled !== undefined) setField('responseStreamEnabled', !!updates.responseStreamEnabled, 'responseStreamEnabledError');
  if (updates.responseStreamChunkSize !== undefined) setField('responseStreamChunkSize', updates.responseStreamChunkSize, 'responseStreamChunkSizeError');
  if (updates.responseStreamChunkOverlap !== undefined) setField('responseStreamChunkOverlap', updates.responseStreamChunkOverlap, 'responseStreamChunkOverlapError');
  if (updates.responseStreamFinalEnabled !== undefined) setField('responseStreamFinalEnabled', !!updates.responseStreamFinalEnabled, 'responseStreamFinalEnabledError');
  if (updates.responseStreamCollectFullEnabled !== undefined) setField('responseStreamCollectFullEnabled', !!updates.responseStreamCollectFullEnabled, 'responseStreamCollectFullEnabledError');

  const writeResult = writeHostConfig(targetHost, next, { r, log: 'err' });
  if (!writeResult.ok) {
    applied.writeError = writeResult.error;
  }

  return applied;
}

export function clearHostConfig(r, host) {
  const targetHost = normalizeHostName(host);
  const write = writeHostConfig(targetHost, {}, { r, log: 'err' });
  const result = { host: targetHost };
  if (!write.ok) {
    result.errors = [write.error];
  }
  return result;
}

export default {
  backendOriginVar
};
