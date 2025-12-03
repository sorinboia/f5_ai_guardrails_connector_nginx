import pino from 'pino';

export function createLogger(config) {
  const level = config.logLevel || 'info';
  return pino({
    level,
    messageKey: 'message',
    base: { service: config.serviceName || 'f5-ai-connector-node' },
    formatters: {
      level(label) {
        return { level: label };
      }
    }
  });
}
