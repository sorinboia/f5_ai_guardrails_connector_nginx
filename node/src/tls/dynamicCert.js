import fs from 'fs';
import path from 'path';
import tls from 'tls';
import crypto from 'crypto';
import forge from 'node-forge';

function loadPem(p) {
  return fs.readFileSync(path.resolve(p), 'utf8');
}

function isValidHost(host) {
  if (!host) return false;
  return /^[A-Za-z0-9.-]+$/.test(host);
}

function buildSubject(host) {
  return [
    { name: 'commonName', value: host }
  ];
}

function buildAltNames(host) {
  const altNames = [];
  if (host) altNames.push({ type: 2, value: host });
  return altNames;
}

function issueLeaf({ host, caCert, caKey, validityDays = 365 }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  cert.setSubject(buildSubject(host));
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: false },
    { name: 'subjectAltName', altNames: buildAltNames(host) }
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey)
  };
}

export class DynamicCertManager {
  constructor(options) {
    const { caCertPath, caKeyPath, defaultCertPath, defaultKeyPath, logger, validityDays = 365 } = options;
    this.logger = logger;
    this.validityDays = validityDays;
    this.cache = new Map();
    this.caCertPem = loadPem(caCertPath);
    this.caKeyPem = loadPem(caKeyPath);
    this.defaultContext = tls.createSecureContext({
      key: loadPem(defaultKeyPath),
      cert: loadPem(defaultCertPath)
    });
    this.caCert = forge.pki.certificateFromPem(this.caCertPem);
    this.caKey = forge.pki.privateKeyFromPem(this.caKeyPem);
  }

  getContext(hostname) {
    const host = (hostname || '').toLowerCase();
    if (!isValidHost(host)) {
      this.logger?.warn({ step: 'dynamic_cert:invalid_host', host }, 'Skipping dynamic cert for invalid host');
      return this.defaultContext;
    }
    if (this.cache.has(host)) return this.cache.get(host);

    try {
      const { certPem, keyPem } = issueLeaf({ host, caCert: this.caCert, caKey: this.caKey, validityDays: this.validityDays });
      const ctx = tls.createSecureContext({ key: keyPem, cert: certPem, ca: this.caCertPem });
      this.cache.set(host, ctx);
      return ctx;
    } catch (err) {
      this.logger?.error({ step: 'dynamic_cert:issue_failed', host, err: err?.message || String(err) });
      return this.defaultContext;
    }
  }
}
