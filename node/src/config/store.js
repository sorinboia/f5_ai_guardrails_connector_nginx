import fs from 'fs';
import path from 'path';
import { normalizeHostList, normalizeHostName } from './hosts.js';

const DEFAULT_STORE_PATH = path.resolve(process.env.CONFIG_STORE_PATH || 'var/guardrails_config.json');

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
  responseStreamCollectFullEnabled: false,
  responseStreamBufferingMode: 'buffer',
  responseStreamChunkGatingEnabled: false,
};

function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function defaultStore() {
  return {
    version: 1,
    hosts: ['__default__'],
    hostConfigs: {
      __default__: { ...SCAN_CONFIG_DEFAULTS },
    },
    apiKeys: [],
    patterns: [],
    collector: {
      entries: [],
      total: 0,
      remaining: 0,
    },
  };
}

function sanitizeCollector(value = {}) {
  const fallback = { entries: [], total: 0, remaining: 0 };
  if (!isPlainObject(value)) return fallback;
  const entries = Array.isArray(value.entries) ? value.entries : fallback.entries;
  const total = Number.isInteger(value.total) ? value.total : fallback.total;
  const remaining = Number.isInteger(value.remaining) ? value.remaining : fallback.remaining;
  return { entries, total, remaining };
}

function normalizeHostConfigs(hostConfigs = {}) {
  const normalized = {};
  if (!isPlainObject(hostConfigs)) return normalized;
  for (const [host, cfg] of Object.entries(hostConfigs)) {
    if (!isPlainObject(cfg)) continue;
    const normalizedHost = normalizeHostName(host);
    normalized[normalizedHost] = cfg;
  }
  return normalized;
}

export function validateStoreShape(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) errors.push('store must be an object');
  if (!Array.isArray(candidate?.hosts)) errors.push('hosts must be an array');
  if (!isPlainObject(candidate?.hostConfigs)) errors.push('hostConfigs must be an object');
  if (!Array.isArray(candidate?.apiKeys)) errors.push('apiKeys must be an array');
  if (!Array.isArray(candidate?.patterns)) errors.push('patterns must be an array');
  if (!isPlainObject(candidate?.collector)) errors.push('collector must be an object');

  if (errors.length) return { ok: false, errors };

  const base = defaultStore();
  const hosts = normalizeHostList(candidate.hosts);
  if (!hosts.includes('__default__')) hosts.unshift('__default__');

  const normalizedHostConfigs = normalizeHostConfigs(candidate.hostConfigs);
  if (!normalizedHostConfigs.__default__) normalizedHostConfigs.__default__ = {};

  const mergedHosts = new Set(hosts);
  Object.keys(normalizedHostConfigs).forEach((host) => mergedHosts.add(host));

  const hostConfigs = {};
  mergedHosts.forEach((host) => {
    const cfg = normalizedHostConfigs[host] || {};
    hostConfigs[host] = isPlainObject(cfg) ? { ...cfg } : {};
  });

  const collector = sanitizeCollector(candidate.collector);
  const version = Number.isInteger(candidate.version) ? candidate.version : base.version;

  return {
    ok: true,
    store: {
      version,
      hosts: Array.from(mergedHosts),
      hostConfigs,
      apiKeys: candidate.apiKeys,
      patterns: candidate.patterns,
      collector,
    }
  };
}

export function loadStore(logger, storePath = DEFAULT_STORE_PATH) {
  const resolved = path.resolve(storePath);
  try {
    const content = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(content);
    const { ok, store, errors } = validateStoreShape(parsed);
    if (!ok) {
      logger?.warn({ errors, storePath: resolved }, 'Using default store (validation failed)');
      return defaultStore();
    }
    return store;
  } catch (err) {
    logger?.warn({ err, storePath: resolved }, 'Using default store (read failed or missing)');
    return defaultStore();
  }
}

export function saveStore(store, logger, storePath = DEFAULT_STORE_PATH) {
  const resolved = path.resolve(storePath);
  try {
    ensureDirExists(resolved);
    const tmpPath = `${resolved}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2));
    fs.renameSync(tmpPath, resolved);
    return true;
  } catch (err) {
    logger?.error({ err, storePath: resolved }, 'Failed to persist store');
    return false;
  }
}
