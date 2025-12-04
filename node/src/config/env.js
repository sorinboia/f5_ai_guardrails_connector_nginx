import fs from 'fs';
import path from 'path';
import { DynamicCertManager } from '../tls/dynamicCert.js';

const DEFAULT_HTTP_PORT = 22080;
const DEFAULT_HTTPS_PORT = 22443;
const DEFAULT_MANAGEMENT_PORT = 22100;
const DEFAULT_FORWARD_PROXY_PORT = 10000;
const DEFAULT_CERT_PATH = '../certs/sideband-local.crt';
const DEFAULT_KEY_PATH = '../certs/sideband-local.key';
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
  const managementPort = Number(process.env.MANAGEMENT_PORT || DEFAULT_MANAGEMENT_PORT);
  const forwardProxyPort = Number(process.env.FORWARD_PROXY_PORT || DEFAULT_FORWARD_PROXY_PORT);
  const forwardProxyEnabled = (process.env.FORWARD_PROXY_ENABLED || 'true').toLowerCase() !== 'false';
  const httpsCert = process.env.HTTPS_CERT || DEFAULT_CERT_PATH;
  const httpsKey = process.env.HTTPS_KEY || DEFAULT_KEY_PATH;
  const httpsEnabled = fileExists(httpsCert) && fileExists(httpsKey);
  const dynamicCertsEnabled = (process.env.DYNAMIC_CERTS_ENABLED || 'false').toLowerCase() === 'true';
  const mitmCaCert = process.env.MITM_CA_CERT || '';
  const mitmCaKey = process.env.MITM_CA_KEY || '';
  const mitmValidityDays = Number(process.env.MITM_CERT_VALIDITY_DAYS || 365);

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
      keyPath: httpsKey,
      dynamicCerts: {
        enabled: dynamicCertsEnabled && Boolean(mitmCaCert) && Boolean(mitmCaKey),
        caCertPath: mitmCaCert,
        caKeyPath: mitmCaKey,
        validityDays: Number.isFinite(mitmValidityDays) && mitmValidityDays > 0 ? mitmValidityDays : 365
      }
    },
    storePath: process.env.CONFIG_STORE_PATH || DEFAULT_STORE_PATH,
    testsLocalSideband: TESTS_LOCAL_SIDEBAND,
    managementPort,
    forwardProxy: {
      enabled: forwardProxyEnabled,
      port: forwardProxyPort
    },
    serviceName: 'f5-ai-connector-node'
  };
}

export function loadTlsOptions(config, logger) {
  if (!config.https.enabled) return null;
  try {
    const baseKey = fs.readFileSync(path.resolve(config.https.keyPath));
    const baseCert = fs.readFileSync(path.resolve(config.https.certPath));

    if (config.https.dynamicCerts?.enabled) {
      try {
        const manager = new DynamicCertManager({
          caCertPath: config.https.dynamicCerts.caCertPath,
          caKeyPath: config.https.dynamicCerts.caKeyPath,
          defaultCertPath: config.https.certPath,
          defaultKeyPath: config.https.keyPath,
          logger,
          validityDays: config.https.dynamicCerts.validityDays
        });

        return {
          key: baseKey,
          cert: baseCert,
          SNICallback: (servername, cb) => {
            const ctx = manager.getContext(servername);
            cb(null, ctx);
          }
        };
      } catch (err) {
        logger?.error({ step: 'tls:dynamic_cert_init_failed', err: err?.message || String(err) });
      }
    }

    return { key: baseKey, cert: baseCert };
  } catch (err) {
    logger?.error({ step: 'tls:load_failed', err: err?.message || String(err) });
    return null;
  }
}
