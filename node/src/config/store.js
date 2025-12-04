import fs from 'fs';
import path from 'path';

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
};

function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
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

export function loadStore(logger, storePath = DEFAULT_STORE_PATH) {
  const resolved = path.resolve(storePath);
  try {
    const content = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(content);
    return parsed;
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
