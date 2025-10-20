export {
  readApiKeys,
  writeApiKeys,
  readPatterns,
  writePatterns,
  findApiKeyByName,
  findPatternById
};

import { makeLogger, readVar, safeJsonParse } from './utils.js';

function readArrayVar(r, varName, fallback) {
  const raw = readVar(r, varName, '[]');
  const parsed = safeJsonParse(raw);
  if (Array.isArray(parsed)) {
    return parsed.slice();
  }
  return Array.isArray(fallback) ? fallback.slice() : [];
}

function writeArrayVar(r, varName, value, opts) {
  const log = makeLogger(opts);
  try {
    r.variables[varName] = JSON.stringify(value);
    return { ok: true };
  } catch (err) {
    if (log) log({ step: 'config_store:write_failed', var: varName, error: String(err) }, 'err');
    return { ok: false, error: String(err) };
  }
}

function readApiKeys(r) {
  return readArrayVar(r, 'scan_config_api_keys_json', []);
}

function writeApiKeys(r, records, opts) {
  return writeArrayVar(r, 'scan_config_api_keys_json', records, opts);
}

function readPatterns(r) {
  return readArrayVar(r, 'scan_config_patterns_json', []);
}

function writePatterns(r, records, opts) {
  return writeArrayVar(r, 'scan_config_patterns_json', records, opts);
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
