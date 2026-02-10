// Config API endpoints
import { normalizeHostName } from '../../config/hosts.js';
import { resolveConfig, validateConfigPatch } from '../../config/validate.js';
import { respondJson, optionsReply, getHeaderHost, ensureHeaderMatchesHost } from '../helpers.js';
import { defaultStore, saveStore } from '../../config/store.js';
import { getBody } from '../../utils/helpers.js';
import { CONFIG_ENUMS } from '../../config/constants.js';

function ensureHost(store, host) {
  const target = normalizeHostName(host);
  if (!store.hosts.includes(target)) store.hosts.push(target);
  if (!store.hostConfigs[target]) store.hostConfigs[target] = {};
  return target;
}

function removeHost(store, host) {
  const target = normalizeHostName(host);
  store.hosts = store.hosts.filter((h) => h !== target);
  delete store.hostConfigs[target];
}

function getConfigTargetHost(request, payload) {
  const bodyHost = payload?.host;
  return normalizeHostName(bodyHost || getHeaderHost(request));
}

export async function configApi(fastify) {
  fastify.options('/config/api', async (_, reply) => optionsReply(reply, 'GET, PATCH, POST, DELETE, OPTIONS', 'content-type, x-guardrails-config-host'));

  fastify.get('/config/api', async (request, reply) => {
    const store = fastify.store || defaultStore();
    const host = getHeaderHost(request);
    ensureHost(store, host);
    const config = resolveConfig(store, host);
    return respondJson(reply, 200, {
      config,
      host,
      hosts: store.hosts,
      options: CONFIG_ENUMS,
      defaults: resolveConfig(store, '__default__')
    });
  });

  fastify.patch('/config/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const targetHost = getConfigTargetHost(request, payload);
    const headerCheck = ensureHeaderMatchesHost(request, targetHost);
    if (!headerCheck.ok) return respondJson(reply, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to update.' });

    const { errors, updates } = validateConfigPatch(payload || {});
    if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });

    ensureHost(store, targetHost);
    const next = { ...store.hostConfigs[targetHost] };

    // Aliases
    if (updates.requestExtractor !== undefined && updates.requestExtractors === undefined) updates.requestExtractors = updates.requestExtractor ? [updates.requestExtractor] : [];
    if (updates.responseExtractor !== undefined && updates.responseExtractors === undefined) updates.responseExtractors = updates.responseExtractor ? [updates.responseExtractor] : [];

    Object.assign(next, updates);
    store.hostConfigs[targetHost] = next;
    saveStore(store, fastify.log, fastify.appConfig.storePath);

    const config = resolveConfig(store, targetHost);
    return respondJson(reply, 200, {
      config,
      applied: updates,
      host: targetHost,
      hosts: store.hosts,
      options: CONFIG_ENUMS,
      defaults: resolveConfig(store, '__default__')
    });
  });

  fastify.post('/config/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const hostValue = payload?.host;
    if (!hostValue || typeof hostValue !== 'string') return respondJson(reply, 400, { error: 'missing_host', message: 'Provide a host field to create a configuration entry.' });
    const targetHost = normalizeHostName(hostValue);
    const headerCheck = ensureHeaderMatchesHost(request, targetHost);
    if (!headerCheck.ok && targetHost !== '__default__') return respondJson(reply, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to create.' });
    if (store.hosts.includes(targetHost)) return respondJson(reply, 409, { error: 'host_exists', message: 'Host already has a configuration entry.' });

    ensureHost(store, targetHost);

    if (payload.config) {
      const { errors, updates } = validateConfigPatch(payload.config);
      if (errors.length) return respondJson(reply, 400, { error: 'validation_failed', errors });
      const next = { ...store.hostConfigs[targetHost], ...updates };
      store.hostConfigs[targetHost] = next;
    }

    saveStore(store, fastify.log, fastify.appConfig.storePath);
    const config = resolveConfig(store, targetHost);
    return respondJson(reply, 201, {
      config,
      applied: payload.config || {},
      host: targetHost,
      hosts: store.hosts,
      options: CONFIG_ENUMS,
      defaults: resolveConfig(store, '__default__')
    });
  });

  fastify.delete('/config/api', async (request, reply) => {
    const payload = getBody(request);
    const store = fastify.store || defaultStore();
    const targetHost = normalizeHostName(payload.host || getHeaderHost(request));
    if (targetHost === '__default__') return respondJson(reply, 400, { error: 'cannot_delete_default', message: 'The default host cannot be removed.' });
    const headerCheck = ensureHeaderMatchesHost(request, targetHost);
    if (!headerCheck.ok) return respondJson(reply, 400, { error: 'host_mismatch', message: 'Set X-Guardrails-Config-Host to the host you intend to delete.' });
    if (!store.hosts.includes(targetHost)) return respondJson(reply, 404, { error: 'host_not_found', message: 'Host configuration not found.' });

    removeHost(store, targetHost);
    saveStore(store, fastify.log, fastify.appConfig.storePath);
    const config = resolveConfig(store, '__default__');
    return respondJson(reply, 200, {
      removed: targetHost,
      host: '__default__',
      hosts: store.hosts,
      config,
      options: CONFIG_ENUMS,
      defaults: config
    });
  });
}
