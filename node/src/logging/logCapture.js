/**
 * Log capture module for intercepting Pino logs and converting them to LogEntry format
 * for the UI logs viewer.
 */

import { Writable } from 'stream';

// Pino log levels (numeric to string)
const PINO_LEVELS = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal'
};

// Normalize Pino level to our log levels
function normalizeLevel(pinoLevel) {
  const numLevel = typeof pinoLevel === 'number' ? pinoLevel : parseInt(pinoLevel, 10);
  const levelName = PINO_LEVELS[numLevel] || pinoLevel;

  // Map to our supported levels
  if (levelName === 'trace') return 'debug';
  if (levelName === 'fatal') return 'error';
  if (['debug', 'info', 'warn', 'error'].includes(levelName)) return levelName;
  return 'info';
}

// Step patterns to capture
const STEP_PATTERNS = [
  /^request:/,
  /^response:/,
  /^stream:/,
  /^proxy:/,
  /^sideband:/
];

// Steps that indicate specific phases
const PHASE_MAP = {
  'request': 'request',
  'response': 'response',
  'stream': 'response_stream',
  'proxy': 'proxy',
  'sideband': 'request' // sideband calls are part of request inspection
};

// Steps that indicate specific statuses
const STATUS_PATTERNS = {
  blocked: /block|flagged/i,
  redacted: /redact/i,
  cleared: /clear|passed|allowed/i,
  skipped: /skip|disabled/i,
  error: /error|fail|timeout/i
};

/**
 * Determine if a log entry should be captured
 * @param {Object} logObj - Parsed log object
 * @returns {boolean}
 */
function shouldCapture(logObj) {
  const level = normalizeLevel(logObj.level);

  // Always capture warn and error
  if (level === 'warn' || level === 'error') {
    return true;
  }

  // Capture steps matching our patterns
  const step = logObj.step || '';
  if (typeof step === 'string') {
    return STEP_PATTERNS.some(pattern => pattern.test(step));
  }

  return false;
}

/**
 * Determine the phase from the step name
 * @param {string} step
 * @returns {string}
 */
function determinePhase(step) {
  if (!step || typeof step !== 'string') return 'proxy';

  const prefix = step.split(':')[0];
  return PHASE_MAP[prefix] || 'proxy';
}

/**
 * Determine the status from log content
 * @param {Object} logObj
 * @returns {string}
 */
function determineStatus(logObj) {
  const level = normalizeLevel(logObj.level);

  // Errors are always error status
  if (level === 'error') return 'error';

  // Check step and message for status indicators
  const searchText = [
    logObj.step || '',
    logObj.message || logObj.msg || '',
    logObj.outcome || '',
    logObj.status || ''
  ].join(' ').toLowerCase();

  for (const [status, pattern] of Object.entries(STATUS_PATTERNS)) {
    if (pattern.test(searchText)) {
      return status;
    }
  }

  // Default to cleared for info logs
  return level === 'warn' ? 'error' : 'cleared';
}

/**
 * Generate a unique log ID
 * @returns {string}
 */
function generateId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `log_${timestamp}_${random}`;
}

/**
 * Safely copy a value, handling complex objects that may have circular references.
 * @param {*} value - The value to copy
 * @param {number} depth - Current recursion depth
 * @returns {*} A safe, serializable copy of the value
 */
function safeCopy(value, depth = 0) {
  // Limit recursion depth
  if (depth > 3) return '[nested]';

  // Handle primitives
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // Handle arrays
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(v => safeCopy(v, depth + 1));
  }

  // Skip known problematic types (Buffers, Streams, Sockets, etc.)
  const constructor = value.constructor?.name;
  if (constructor && ['Socket', 'Stream', 'IncomingMessage', 'ServerResponse',
                       'Buffer', 'HTTPParser', 'EventEmitter', 'Readable',
                       'Writable', 'Duplex', 'Transform', 'PassThrough'].includes(constructor)) {
    return `[${constructor}]`;
  }

  // Handle Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle plain objects
  const result = {};
  const keys = Object.keys(value).slice(0, 20); // Limit number of keys
  for (const key of keys) {
    try {
      result[key] = safeCopy(value[key], depth + 1);
    } catch (err) {
      result[key] = '[error]';
    }
  }
  return result;
}

/**
 * Convert a Pino log object to our LogEntry format
 * @param {Object} logObj - Parsed Pino log object
 * @returns {Object} LogEntry
 */
function toLogEntry(logObj) {
  const level = normalizeLevel(logObj.level);
  const step = logObj.step || '';
  const phase = determinePhase(step);
  const status = determineStatus(logObj);

  // Extract message from Pino format
  const message = logObj.message || logObj.msg || step || 'Log entry';

  // Build details object with extra fields
  const details = {};
  // Skip fields that are either already extracted or known to cause issues
  const skipFields = ['level', 'time', 'pid', 'hostname', 'service', 'msg', 'message',
                      'step', 'trace_id', 'host', 'url', 'method', 'pattern_id',
                      'pattern_name', 'api_key_name', 'v',
                      // Skip known problematic Pino/Fastify fields
                      'req', 'res', 'responseTime', 'err', 'reqId',
                      'host_log_level', 'upstream_host'];

  for (const [key, value] of Object.entries(logObj)) {
    if (!skipFields.includes(key) && value !== undefined) {
      details[key] = safeCopy(value);
    }
  }

  return {
    id: generateId(),
    timestamp: logObj.time ? new Date(logObj.time).toISOString() : new Date().toISOString(),
    trace_id: logObj.trace_id || logObj.reqId || logObj.req?.id || '',
    host: logObj.host || logObj.upstream_host || '',
    phase,
    status,
    pattern_id: logObj.pattern_id || logObj.patternId || undefined,
    pattern_name: logObj.pattern_name || logObj.patternName || undefined,
    api_key_name: logObj.api_key_name || logObj.apiKeyName || undefined,
    url: logObj.url || logObj.req?.url || '',
    method: logObj.method || logObj.req?.method || '',
    level,
    message,
    details: Object.keys(details).length > 0 ? details : undefined
  };
}

/**
 * Create a Pino destination that captures logs to a ring buffer
 * @param {LogRingBuffer} logBuffer - The ring buffer to push entries to
 * @param {Object} options - Additional options
 * @param {boolean} options.alsoLog - Whether to also write to stdout (default: true)
 * @returns {Writable} A writable stream for Pino
 */
export function createLogCapture(logBuffer, options = {}) {
  const { alsoLog = true } = options;

  return new Writable({
    write(chunk, encoding, callback) {
      const line = chunk.toString();

      // Also output to stdout if requested
      if (alsoLog) {
        process.stdout.write(chunk);
      }

      // Parse the JSON log line
      let logObj;
      try {
        logObj = JSON.parse(line);
      } catch (err) {
        // Not JSON, skip
        callback();
        return;
      }

      // Check if we should capture this log
      if (shouldCapture(logObj)) {
        const entry = toLogEntry(logObj);
        logBuffer.push(entry);
      }

      callback();
    }
  });
}

/**
 * Create a multi-destination for Pino that captures to buffer while preserving original output
 * This is the recommended way to integrate with an existing Pino setup.
 * @param {LogRingBuffer} logBuffer
 * @returns {Function} A function that processes log objects
 */
export function createLogCaptureHook(logBuffer) {
  return function captureHook(logObj) {
    if (shouldCapture(logObj)) {
      const entry = toLogEntry(logObj);
      logBuffer.push(entry);
    }
  };
}

// Export helpers for testing
export {
  shouldCapture,
  determinePhase,
  determineStatus,
  toLogEntry,
  normalizeLevel,
  generateId
};
