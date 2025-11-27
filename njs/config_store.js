export {
  readApiKeys,
  writeApiKeys,
  readPatterns,
  writePatterns,
  findApiKeyByName,
  findPatternById
};

import { makeLogger, readSharedJson, writeSharedJson } from './utils.js';

const API_KEYS_KEY = 'config:api_keys';
const PATTERNS_KEY = 'config:patterns';

function readArrayStore(key, fallback) {
  const data = readSharedJson(key, fallback);
  if (Array.isArray(data)) {
    return data.slice();
  }
  return Array.isArray(fallback) ? fallback.slice() : [];
}

function writeArrayStore(key, value, opts) {
  const log = makeLogger(opts);
  const res = writeSharedJson(key, value, opts);
  if (!res.ok && log) {
    log({ step: 'config_store:write_failed', key, error: res.error }, 'err');
  }
  return res;
}

function readApiKeys(r) {
  return readArrayStore(API_KEYS_KEY, []);
}

function writeApiKeys(r, records, opts) {
  return writeArrayStore(API_KEYS_KEY, records, opts);
}

function readPatterns(r) {
  return readArrayStore(PATTERNS_KEY, []);
}

function writePatterns(r, records, opts) {
  return writeArrayStore(PATTERNS_KEY, records, opts);
}

function findApiKeyByName(records, name) {
  if (!Array.isArray(records)) return undefined;
  const target = typeof name === 'string' ? name.trim() : '';
  if (!target) return undefined;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record && typeof record.name === 'string' && record.name === target) {
      return record;
    }
  }
  return undefined;
}

function findPatternById(records, id) {
  if (!Array.isArray(records)) return undefined;
  const target = typeof id === 'string' ? id.trim() : '';
  if (!target) return undefined;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record && typeof record.id === 'string' && record.id === target) {
      return record;
    }
  }
  return undefined;
}
