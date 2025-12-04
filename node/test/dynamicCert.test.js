import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';
import { describe, it, expect } from 'vitest';
import { DynamicCertManager } from '../src/tls/dynamicCert.js';

function writeTempPem(name, pem) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-cert-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, pem);
  return file;
}

function createCa() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  cert.setSubject([{ name: 'commonName', value: 'Test CA' }]);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey)
  };
}

function createServerCert(commonName) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey)
  };
}

describe('DynamicCertManager', () => {
  it('returns cached dynamic contexts per host and falls back for invalid host', () => {
    const ca = createCa();
    const server = createServerCert('fallback.local');
    const caCertPath = writeTempPem('ca.crt', ca.certPem);
    const caKeyPath = writeTempPem('ca.key', ca.keyPem);
    const defaultCertPath = writeTempPem('default.crt', server.certPem);
    const defaultKeyPath = writeTempPem('default.key', server.keyPem);

    const manager = new DynamicCertManager({
      caCertPath,
      caKeyPath,
      defaultCertPath,
      defaultKeyPath,
      validityDays: 30
    });

    const ctxA = manager.getContext('example.com');
    const ctxA2 = manager.getContext('example.com');
    const ctxB = manager.getContext('another.example');
    const ctxInvalid = manager.getContext('');

    expect(ctxA).toBe(ctxA2); // cached
    expect(ctxA).not.toBe(manager.defaultContext);
    expect(ctxB).not.toBe(ctxA);
    expect(ctxInvalid).toBe(manager.defaultContext);
  });
});
