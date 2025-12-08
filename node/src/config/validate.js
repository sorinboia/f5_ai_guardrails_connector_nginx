import { SCAN_CONFIG_DEFAULTS } from './store.js';
import { normalizeHostName } from './hosts.js';

export { normalizeHostName };

export const SCAN_CONFIG_ENUMS = {
  inspectMode: ['off', 'request', 'response', 'both'],
  redactMode: ['off', 'request', 'response', 'both', 'on', 'true'],
  logLevel: ['debug', 'info', 'warn', 'err'],
  requestForwardMode: ['sequential', 'parallel'],
  responseStreamBufferingMode: ['buffer', 'passthrough'],
};

function isHttpUrl(value) {
  return typeof value === 'string' && /^(https?:)\/\//i.test(value);
}

function coerceBoolean(value) {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off'].includes(lower)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function coerceInteger(value) {
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return undefined;
  return num;
}

export function validateConfigPatch(patch = {}) {
  const errors = [];
  const updates = {};

  if (patch.inspectMode !== undefined) {
    const val = String(patch.inspectMode).toLowerCase();
    if (!SCAN_CONFIG_ENUMS.inspectMode.includes(val)) errors.push('invalid inspectMode');
    else updates.inspectMode = val;
  }

  if (patch.redactMode !== undefined) {
    const val = String(patch.redactMode).toLowerCase();
    if (!SCAN_CONFIG_ENUMS.redactMode.includes(val)) errors.push('invalid redactMode');
    else updates.redactMode = (val === 'on' || val === 'true') ? 'both' : val;
  }

  if (patch.logLevel !== undefined) {
    const val = String(patch.logLevel).toLowerCase();
    if (!SCAN_CONFIG_ENUMS.logLevel.includes(val)) errors.push('invalid logLevel');
    else updates.logLevel = val;
  }

  if (patch.requestForwardMode !== undefined) {
    const val = String(patch.requestForwardMode).toLowerCase();
    if (!SCAN_CONFIG_ENUMS.requestForwardMode.includes(val)) errors.push('invalid requestForwardMode');
    else updates.requestForwardMode = val;
  }

  if (patch.responseStreamBufferingMode !== undefined) {
    const val = String(patch.responseStreamBufferingMode).toLowerCase();
    if (!SCAN_CONFIG_ENUMS.responseStreamBufferingMode.includes(val)) errors.push('invalid responseStreamBufferingMode');
    else updates.responseStreamBufferingMode = val;
  }

  if (patch.backendOrigin !== undefined) {
    const val = String(patch.backendOrigin);
    if (!isHttpUrl(val)) errors.push('backendOrigin must start with http:// or https://');
    else updates.backendOrigin = val;
  }

  if (patch.requestExtractor !== undefined) {
    updates.requestExtractor = String(patch.requestExtractor);
  }
  if (patch.responseExtractor !== undefined) {
    updates.responseExtractor = String(patch.responseExtractor);
  }

  if (patch.requestExtractors !== undefined) {
    if (!Array.isArray(patch.requestExtractors)) errors.push('requestExtractors must be array');
    else updates.requestExtractors = patch.requestExtractors.map((x) => String(x));
  }

  if (patch.responseExtractors !== undefined) {
    if (!Array.isArray(patch.responseExtractors)) errors.push('responseExtractors must be array');
    else updates.responseExtractors = patch.responseExtractors.map((x) => String(x));
  }

  if (patch.extractorParallelEnabled !== undefined || patch.extractorParallel !== undefined) {
    const val = coerceBoolean(patch.extractorParallelEnabled ?? patch.extractorParallel);
    if (val === undefined) errors.push('extractorParallelEnabled must be boolean');
    else updates.extractorParallel = val;
  }

  if (patch.responseStreamEnabled !== undefined) {
    const val = coerceBoolean(patch.responseStreamEnabled);
    if (val === undefined) errors.push('responseStreamEnabled must be boolean');
    else updates.responseStreamEnabled = val;
  }
  if (patch.responseStreamFinalEnabled !== undefined) {
    const val = coerceBoolean(patch.responseStreamFinalEnabled);
    if (val === undefined) errors.push('responseStreamFinalEnabled must be boolean');
    else updates.responseStreamFinalEnabled = val;
  }
  if (patch.responseStreamCollectFullEnabled !== undefined) {
    const val = coerceBoolean(patch.responseStreamCollectFullEnabled);
    if (val === undefined) errors.push('responseStreamCollectFullEnabled must be boolean');
    else updates.responseStreamCollectFullEnabled = val;
  }

  if (patch.responseStreamChunkGatingEnabled !== undefined) {
    const val = coerceBoolean(patch.responseStreamChunkGatingEnabled);
    if (val === undefined) errors.push('responseStreamChunkGatingEnabled must be boolean');
    else updates.responseStreamChunkGatingEnabled = val;
  }

  if (patch.responseStreamChunkSize !== undefined) {
    const val = coerceInteger(patch.responseStreamChunkSize);
    if (val === undefined || val < 128 || val > 65536) errors.push('responseStreamChunkSize must be between 128 and 65536');
    else updates.responseStreamChunkSize = val;
  }
  if (patch.responseStreamChunkOverlap !== undefined) {
    const val = coerceInteger(patch.responseStreamChunkOverlap);
    if (val === undefined || val < 0) errors.push('responseStreamChunkOverlap must be non-negative integer');
    else updates.responseStreamChunkOverlap = val;
  }

  const size = updates.responseStreamChunkSize;
  const overlap = updates.responseStreamChunkOverlap;
  if (size !== undefined && overlap !== undefined && overlap >= size) {
    errors.push('responseStreamChunkOverlap must be less than responseStreamChunkSize');
  }

  return { errors, updates };
}

export function resolveConfig(store, host) {
  const target = normalizeHostName(host);
  const defaultCfg = store.hostConfigs?.__default__ || {};
  const hostCfg = store.hostConfigs?.[target] || {};
  // Inherit __default__ so new hosts get the same extractors/behaviour unless explicitly overridden.
  const merged = target === '__default__'
    ? { ...SCAN_CONFIG_DEFAULTS, ...defaultCfg }
    : { ...SCAN_CONFIG_DEFAULTS, ...defaultCfg, ...hostCfg };
  merged.requestExtractor = merged.requestExtractors && merged.requestExtractors.length ? merged.requestExtractors[0] : '';
  merged.responseExtractor = merged.responseExtractors && merged.responseExtractors.length ? merged.responseExtractors[0] : '';
  merged.extractorParallelEnabled = merged.extractorParallel !== undefined ? merged.extractorParallel : merged.extractorParallelEnabled;
  return merged;
}
