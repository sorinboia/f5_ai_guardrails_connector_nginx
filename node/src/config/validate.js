import {
  SCAN_CONFIG_DEFAULTS,
  CONFIG_ENUMS,
  CONFIG_ENUM_ALIASES,
  STREAM_CHUNK_SIZE_MIN,
  STREAM_CHUNK_SIZE_MAX
} from './constants.js';
import { normalizeHostName } from './hosts.js';
import { isHttpUrl, coerceBoolean, coerceInteger } from '../utils/typeGuards.js';

// Validation schema for config patches
const PATCH_SCHEMA = {
  inspectMode: { type: 'enum', enumKey: 'inspectMode' },
  redactMode: { type: 'enum', enumKey: 'redactMode', aliases: CONFIG_ENUM_ALIASES.redactMode },
  logLevel: { type: 'enum', enumKey: 'logLevel' },
  requestForwardMode: { type: 'enum', enumKey: 'requestForwardMode' },
  responseStreamBufferingMode: { type: 'enum', enumKey: 'responseStreamBufferingMode' },
  backendOrigin: { type: 'url' },
  requestExtractor: { type: 'string' },
  responseExtractor: { type: 'string' },
  requestExtractors: { type: 'stringArray' },
  responseExtractors: { type: 'stringArray' },
  extractorParallelEnabled: { type: 'boolean', outputKey: 'extractorParallel' },
  extractorParallel: { type: 'boolean', outputKey: 'extractorParallel' },
  responseStreamEnabled: { type: 'boolean' },
  responseStreamFinalEnabled: { type: 'boolean' },
  responseStreamCollectFullEnabled: { type: 'boolean' },
  responseStreamChunkGatingEnabled: { type: 'boolean' },
  responseStreamChunkSize: { type: 'integer', min: STREAM_CHUNK_SIZE_MIN, max: STREAM_CHUNK_SIZE_MAX },
  responseStreamChunkOverlap: { type: 'integer', min: 0 }
};

function validateEnumField(value, enumKey, aliases) {
  const val = String(value).toLowerCase();
  if (aliases && aliases[val]) return { valid: true, value: aliases[val] };
  if (CONFIG_ENUMS[enumKey].includes(val)) return { valid: true, value: val };
  return { valid: false, error: `invalid ${enumKey}` };
}

function validateUrlField(value) {
  const val = String(value);
  if (!isHttpUrl(val)) return { valid: false, error: 'backendOrigin must start with http:// or https://' };
  return { valid: true, value: val };
}

function validateStringField(value) {
  return { valid: true, value: String(value) };
}

function validateStringArrayField(value, fieldName) {
  if (!Array.isArray(value)) return { valid: false, error: `${fieldName} must be array` };
  return { valid: true, value: value.map((x) => String(x)) };
}

function validateBooleanField(value, fieldName) {
  const val = coerceBoolean(value);
  if (val === undefined) return { valid: false, error: `${fieldName} must be boolean` };
  return { valid: true, value: val };
}

function validateIntegerField(value, fieldName, min, max) {
  const val = coerceInteger(value);
  if (val === undefined) return { valid: false, error: `${fieldName} must be integer` };
  if (min !== undefined && val < min) return { valid: false, error: `${fieldName} must be at least ${min}` };
  if (max !== undefined && val > max) return { valid: false, error: `${fieldName} must be at most ${max}` };
  return { valid: true, value: val };
}

function validateField(fieldName, value, schema) {
  switch (schema.type) {
    case 'enum':
      return validateEnumField(value, schema.enumKey, schema.aliases);
    case 'url':
      return validateUrlField(value);
    case 'string':
      return validateStringField(value);
    case 'stringArray':
      return validateStringArrayField(value, fieldName);
    case 'boolean':
      return validateBooleanField(value, fieldName);
    case 'integer':
      return validateIntegerField(value, fieldName, schema.min, schema.max);
    default:
      return { valid: false, error: `unknown field type for ${fieldName}` };
  }
}

export function validateConfigPatch(patch = {}) {
  const errors = [];
  const updates = {};

  for (const [fieldName, schema] of Object.entries(PATCH_SCHEMA)) {
    if (patch[fieldName] === undefined) continue;

    const result = validateField(fieldName, patch[fieldName], schema);
    if (!result.valid) {
      errors.push(result.error);
    } else {
      const outputKey = schema.outputKey || fieldName;
      updates[outputKey] = result.value;
    }
  }

  // Cross-field validation: overlap must be less than chunk size
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
  const merged = target === '__default__'
    ? { ...SCAN_CONFIG_DEFAULTS, ...defaultCfg }
    : { ...SCAN_CONFIG_DEFAULTS, ...defaultCfg, ...hostCfg };
  merged.requestExtractor = merged.requestExtractors && merged.requestExtractors.length ? merged.requestExtractors[0] : '';
  merged.responseExtractor = merged.responseExtractors && merged.responseExtractors.length ? merged.responseExtractors[0] : '';
  merged.extractorParallelEnabled = merged.extractorParallel !== undefined ? merged.extractorParallel : merged.extractorParallelEnabled;
  return merged;
}
