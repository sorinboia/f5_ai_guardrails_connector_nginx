// Centralized defaults and constants for the F5 AI Guardrails Connector.

// Server ports
export const DEFAULT_HTTP_PORT = 22080;
export const DEFAULT_HTTPS_PORT = 22443;
export const DEFAULT_MANAGEMENT_PORT = 22100;
export const DEFAULT_FORWARD_PROXY_PORT = 10000;

// TLS paths
export const DEFAULT_CERT_PATH = '../certs/sideband-local.crt';
export const DEFAULT_KEY_PATH = '../certs/sideband-local.key';

// Backend/Sideband defaults
export const DEFAULT_BACKEND_ORIGIN = 'https://api.openai.com';
export const DEFAULT_SIDEBAND_URL = 'https://www.us1.calypsoai.app/backend/v1/scans';
export const DEFAULT_SIDEBAND_TIMEOUT_MS = 5000;
export const DEFAULT_SIDEBAND_BEARER = '';
export const DEFAULT_SIDEBAND_UA = 'njs-sideband/1.0';
export const TESTS_LOCAL_SIDEBAND = 'http://127.0.0.1:18081/backend/v1/scans';

// Store
export const DEFAULT_STORE_PATH = 'var/guardrails_config.json';
export const DEFAULT_LOG_BUFFER_SIZE = 1000;

// Streaming defaults
export const REQUEST_PATHS_DEFAULT = ['.messages[-1].content'];
export const RESPONSE_PATHS_DEFAULT = ['.message.content'];
export const STREAM_CHUNK_SIZE_DEFAULT = 2048;
export const STREAM_CHUNK_OVERLAP_DEFAULT = 128;
export const STREAM_CHUNK_SIZE_MIN = 128;
export const STREAM_CHUNK_SIZE_MAX = 65536;

// Inspection limits
export const EXTRACT_PREVIEW_LIMIT = 4000;

// Collector limits
export const COLLECTOR_MAX_ENTRIES = 50;

// Configuration enums (single source of truth)
export const CONFIG_ENUMS = {
  inspectMode: ['off', 'request', 'response', 'both'],
  redactMode: ['off', 'request', 'response', 'both', 'on', 'true'],
  logLevel: ['debug', 'info', 'warn', 'err'],
  requestForwardMode: ['sequential', 'parallel'],
  responseStreamBufferingMode: ['buffer', 'passthrough'],
};

// Configuration enum aliases
export const CONFIG_ENUM_ALIASES = {
  redactMode: { on: 'both', true: 'both' },
};

// Scan config defaults
export const SCAN_CONFIG_DEFAULTS = {
  inspectMode: 'both',
  redactMode: 'both',
  logLevel: 'info',
  requestForwardMode: 'sequential',
  backendOrigin: DEFAULT_BACKEND_ORIGIN,
  requestExtractor: '',
  responseExtractor: '',
  requestExtractors: [],
  responseExtractors: [],
  extractorParallel: false,
  responseStreamEnabled: true,
  responseStreamChunkSize: STREAM_CHUNK_SIZE_DEFAULT,
  responseStreamChunkOverlap: STREAM_CHUNK_OVERLAP_DEFAULT,
  responseStreamFinalEnabled: true,
  responseStreamCollectFullEnabled: false,
  responseStreamBufferingMode: 'buffer',
  responseStreamChunkGatingEnabled: false,
};

// Default blocking response
export const DEFAULT_BLOCKING_RESPONSE = {
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ message: { role: 'assistant', content: 'F5 AI Guardrails blocked this request' } })
};
