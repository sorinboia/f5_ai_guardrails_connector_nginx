import fs from 'fs';
import path from 'path';
import Fastify from 'fastify';
import pino from 'pino';
import { randomUUID } from 'crypto';
import routes from './routes/index.js';
import { loadConfigFromEnv, loadTlsOptions } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { LogRingBuffer } from './logging/logBuffer.js';
import { createLogCaptureHook } from './logging/logCapture.js';
import { loadStore, saveStore, validateStoreShape } from './config/store.js';
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
      const { ok, store: next, errors } = validateStoreShape(parsed);
      if (!ok) {
        logger.warn({ errors, storePath: resolved }, 'Rejected store reload due to validation errors');
        return;
      }
      applyStoreUpdate(store, next);
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

/**
 * Create a logger with log capture hook for the UI logs viewer
 * @param {Object} config - Application config
 * @param {LogRingBuffer} logBuffer - Ring buffer to capture logs to
 * @returns {pino.Logger}
 */
function createLoggerWithCapture(config, logBuffer) {
  const level = config.logLevel || 'info';
  const captureHook = createLogCaptureHook(logBuffer);

  return pino({
    level,
    messageKey: 'message',
    base: { service: config.serviceName || 'f5-ai-connector-node' },
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    hooks: {
      // Hook into Pino's logging to capture entries for the UI
      logMethod(inputArgs, method, level) {
        // Call original method first
        method.apply(this, inputArgs);

        // Capture the log entry
        try {
          // Build the log object from args
          const [first, ...rest] = inputArgs;
          let logObj = {};

          if (typeof first === 'object' && first !== null) {
            logObj = { ...first };
            if (rest.length && typeof rest[0] === 'string') {
              logObj.message = rest[0];
            }
          } else if (typeof first === 'string') {
            logObj.message = first;
          }

          logObj.level = level;
          logObj.time = Date.now();

          // Include bindings from child loggers (like host, trace_id, etc.)
          // Pino stores bindings in the chindings property as a JSON string suffix
          // We need to extract them from the logger instance
          if (this && this.bindings) {
            const bindings = this.bindings();
            Object.assign(logObj, bindings);
          }

          captureHook(logObj);
        } catch (err) {
          // Ignore capture errors
        }
      }
    }
  });
}

function buildApp(config, logger, store, tlsOptions = null, routeOptions = {}, logBuffer = null) {
  const app = Fastify({
    logger,
    trustProxy: true,
    https: tlsOptions || undefined,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'trace_id',
    genReqId: () => randomUUID()
  });

  app.decorate('appConfig', config);
  app.decorate('store', store);
  app.decorate('saveStore', (nextStore) => saveStore(nextStore, logger, config.storePath));

  // Add logBuffer for management server (logs API)
  if (logBuffer) {
    app.decorate('logBuffer', logBuffer);
  }

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

  // Create shared log ring buffer for UI logs viewer
  const logBuffer = new LogRingBuffer(config.logBufferSize);

  // Create logger with capture hook
  const logger = createLoggerWithCapture(config, logBuffer);

  const store = loadStore(logger, config.storePath);
  watchStore(store, logger, config.storePath);

  // Management server gets the logBuffer for the logs API
  const managementApp = buildApp(config, logger, store, null, {
    enableProxy: false,
    enableStatic: true,
    enableManagement: true
  }, logBuffer);
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
