import fs from 'fs';
import path from 'path';
import Fastify from 'fastify';
import routes from './routes/index.js';
import { loadConfigFromEnv, loadTlsOptions } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { loadStore, saveStore } from './config/store.js';
import { startForwardProxy } from './forwardProxy.js';

function applyStoreUpdate(target, next) {
  // Mutate the existing store object so Fastify decorators keep references.
  const currentKeys = new Set(Object.keys(target));
  Object.keys(next).forEach((key) => {
    target[key] = next[key];
    currentKeys.delete(key);
  });
  currentKeys.forEach((key) => {
    delete target[key];
  });
}

function watchStore(store, logger, storePath) {
  const resolved = path.resolve(storePath);
  // Ensure file exists so watch does not fail on first boot.
  try {
    fs.accessSync(resolved, fs.constants.F_OK);
  } catch (err) {
    saveStore(store, logger, resolved);
  }

  const reloadFromDisk = () => {
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      const parsed = JSON.parse(content);
      applyStoreUpdate(store, parsed);
      logger.info({ storePath: resolved }, 'Store reloaded from disk');
    } catch (err) {
      logger.warn({ err, storePath: resolved }, 'Failed to reload store file');
    }
  };

  try {
    const watcher = fs.watch(resolved, { persistent: false }, (eventType) => {
      if (eventType !== 'change' && eventType !== 'rename') return;
      reloadFromDisk();
    });
    watcher.on('error', (err) => {
      logger.warn({ err, storePath: resolved }, 'Store watch error');
    });
    return watcher;
  } catch (err) {
    logger.warn({ err, storePath: resolved }, 'fs.watch failed; falling back to watchFile');
    fs.watchFile(resolved, { interval: 1000 }, () => reloadFromDisk());
    return null;
  }
}

function buildApp(config, logger, store, tlsOptions = null, routeOptions = {}) {
  const app = Fastify({
    logger,
    trustProxy: true,
    https: tlsOptions || undefined
  });

  app.decorate('appConfig', config);
  app.decorate('store', store);
  app.decorate('saveStore', (nextStore) => saveStore(nextStore, logger, config.storePath));

  app.register(routes, {
    backendOrigin: config.backendOrigin,
    ...routeOptions
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ step: 'not_found' }, 'Unhandled route');
    reply.code(404).send({ message: 'Not implemented in Node proxy yet' });
  });

  return app;
}

async function start() {
  const config = loadConfigFromEnv();
  const logger = createLogger(config);
  const store = loadStore(logger, config.storePath);
  watchStore(store, logger, config.storePath);

  const managementApp = buildApp(config, logger, store, null, {
    enableProxy: false,
    enableStatic: true,
    enableManagement: true
  });
  await managementApp.listen({ port: config.managementPort, host: '0.0.0.0' });
  logger.info({ port: config.managementPort }, 'Management listener started');

  const httpApp = buildApp(config, logger, store, null, {
    enableProxy: true,
    enableStatic: false,
    enableManagement: false
  });
  await httpApp.listen({ port: config.httpPort, host: '0.0.0.0' });
  logger.info({ port: config.httpPort }, 'HTTP listener started');

  const tlsOptions = loadTlsOptions(config, logger);
  if (tlsOptions) {
    const httpsApp = buildApp(config, logger, store, tlsOptions, {
      enableProxy: true,
      enableStatic: false,
      enableManagement: false
    });
    await httpsApp.listen({ port: config.https.port, host: '0.0.0.0' });
    logger.info({ port: config.https.port }, 'HTTPS listener started');

    startForwardProxy(config, store, logger);
  } else {
    logger.warn('HTTPS listener skipped (cert/key not found or unreadable)');
    startForwardProxy(config, store, logger);
  }
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
