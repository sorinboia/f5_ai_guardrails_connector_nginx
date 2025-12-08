import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify from 'fastify';
import managementRoutes from '../src/routes/management.js';
import { defaultStore } from '../src/config/store.js';

function buildApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrails-store-'));
  const storePath = path.join(tmpDir, 'store.json');
  const store = defaultStore();
  const app = Fastify({ logger: false });
  app.decorate('store', store);
  app.decorate('appConfig', { storePath, logLevel: 'info' });
  app.register(managementRoutes);
  return { app, store, storePath, tmpDir };
}

function cleanup(app, tmpDir) {
  if (app) app.close();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('/config/api/store', () => {
  let context;

  beforeEach(async () => {
    context = buildApp();
    await context.app.ready();
  });

  afterEach(() => {
    cleanup(context?.app, context?.tmpDir);
  });

  it('returns the full store with attachment headers', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/config/api/store',
      headers: { Accept: 'application/json' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="guardrails-config-.*\.json"/);
    const body = response.json();
    expect(body).toMatchObject(defaultStore());
  });

  it('replaces the in-memory store and persists to disk on PUT', async () => {
    const nextStore = defaultStore();
    nextStore.hosts.push('example.com');
    nextStore.hostConfigs['example.com'] = { backendOrigin: 'https://example.com', inspectMode: 'both' };

    const response = await context.app.inject({
      method: 'PUT',
      url: '/config/api/store',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      payload: JSON.stringify(nextStore)
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hosts).toContain('example.com');
    expect(body.store.hostConfigs['example.com'].backendOrigin).toBe('https://example.com');

    // Same object reference mutated
    expect(context.store.hosts).toContain('example.com');

    // Persisted file should contain the new host
    const disk = JSON.parse(fs.readFileSync(context.storePath, 'utf8'));
    expect(disk.hosts).toContain('example.com');
  });

  it('rejects invalid payloads with 400', async () => {
    const response = await context.app.inject({
      method: 'PUT',
      url: '/config/api/store',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      payload: JSON.stringify({})
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_failed');
    // Store remains unchanged
    expect(context.store.hosts).toEqual(['__default__']);
  });
});
