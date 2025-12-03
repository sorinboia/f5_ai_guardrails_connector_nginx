import fs from 'fs';
import path from 'path';

const DEFAULT_HTTP_PORT = 11434;
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_CERT_PATH = '/etc/nginx/certs/sideband-local.crt';
const DEFAULT_KEY_PATH = '/etc/nginx/certs/sideband-local.key';
const DEFAULT_BACKEND_ORIGIN = 'https://api.openai.com';
const DEFAULT_SIDEBAND_URL = 'https://www.us1.calypsoai.app/backend/v1/scans';
const DEFAULT_SIDEBAND_TIMEOUT_MS = 5000;
const DEFAULT_SIDEBAND_BEARER = '';
const DEFAULT_SIDEBAND_UA = 'njs-sideband/1.0';
const TESTS_LOCAL_SIDEBAND = 'http://127.0.0.1:18081/backend/v1/scans';
const DEFAULT_STORE_PATH = 'var/guardrails_config.json';

function fileExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (err) {
    return false;
  }
}

export function loadConfigFromEnv() {
  const backendOrigin = process.env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;
  const sidebandUrl = process.env.SIDEBAND_URL || DEFAULT_SIDEBAND_URL;
  const caBundle = process.env.CA_BUNDLE || '/etc/ssl/certs/ca-certificates.crt';
  const logLevel = process.env.LOG_LEVEL || 'info';
  const httpPort = Number(process.env.HTTP_PORT || DEFAULT_HTTP_PORT);
  const httpsPort = Number(process.env.HTTPS_PORT || DEFAULT_HTTPS_PORT);
  const httpsCert = process.env.HTTPS_CERT || DEFAULT_CERT_PATH;
  const httpsKey = process.env.HTTPS_KEY || DEFAULT_KEY_PATH;
  const httpsEnabled = fileExists(httpsCert) && fileExists(httpsKey);

  return {
    backendOrigin,
    sidebandUrl,
    sidebandBearer: process.env.SIDEBAND_BEARER || DEFAULT_SIDEBAND_BEARER,
    sidebandUa: process.env.SIDEBAND_UA || DEFAULT_SIDEBAND_UA,
    sidebandTimeoutMs: Number(process.env.SIDEBAND_TIMEOUT_MS || DEFAULT_SIDEBAND_TIMEOUT_MS),
    caBundle,
    logLevel,
    httpPort,
    https: {
      enabled: httpsEnabled,
      port: httpsPort,
      certPath: httpsCert,
      keyPath: httpsKey
    },
    storePath: process.env.CONFIG_STORE_PATH || DEFAULT_STORE_PATH,
    testsLocalSideband: TESTS_LOCAL_SIDEBAND,
    serviceName: 'f5-ai-connector-node'
  };
}

export function loadTlsOptions(config) {
  if (!config.https.enabled) return null;
  try {
    return {
      key: fs.readFileSync(path.resolve(config.https.keyPath)),
      cert: fs.readFileSync(path.resolve(config.https.certPath))
    };
  } catch (err) {
    return null;
  }
}
