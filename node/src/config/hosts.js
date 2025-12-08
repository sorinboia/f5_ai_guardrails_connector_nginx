export function normalizeHostName(host) {
  const value = (host || '').trim().toLowerCase();
  return value || '__default__';
}

export function normalizeHostList(hosts = []) {
  if (!Array.isArray(hosts)) return [];
  const seen = new Set();
  const normalized = [];
  for (const host of hosts) {
    const value = normalizeHostName(host);
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function buildHostAllowlist(store = {}) {
  const allowed = new Set();
  const hosts = normalizeHostList(store.hosts || []);
  for (const host of hosts) {
    if (host === '__default__') continue;
    allowed.add(host);
  }
  const configs = store.hostConfigs || {};
  for (const key of Object.keys(configs)) {
    const host = normalizeHostName(key);
    if (host === '__default__') continue;
    allowed.add(host);
  }
  return allowed;
}

export function isHostAllowed(store, host) {
  const normalized = normalizeHostName(host);
  if (normalized === '__default__') return false;
  const allowlist = buildHostAllowlist(store);
  return allowlist.has(normalized);
}
