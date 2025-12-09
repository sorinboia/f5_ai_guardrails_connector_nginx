import http from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { request as undiciRequest } from 'undici';
import proxyRoutes from '../src/routes/proxy.js';
import { defaultStore } from '../src/config/store.js';

function startBackend(label) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`${label}:${req.url}`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        getHits: () => hits,
      });
    });
  });
}

describe('/api/tags bypass routing', () => {
  let defaultBackend;
  let chatBackend;
  let fastify;
  let baseUrl;

  beforeAll(async () => {
    defaultBackend = await startBackend('default');
    chatBackend = await startBackend('chat');

    const store = defaultStore();
    store.hosts.push('chat-app.lab');
    store.hostConfigs.__default__.backendOrigin = defaultBackend.url;
    store.hostConfigs['chat-app.lab'] = {
      backendOrigin: chatBackend.url,
      inspectMode: 'off'
    };

    fastify = Fastify({ logger: false });
    fastify.decorate('appConfig', { backendOrigin: defaultBackend.url, logLevel: 'info' });
    fastify.decorate('store', store);
    fastify.register(proxyRoutes, { backendOrigin: defaultBackend.url });
    await fastify.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${fastify.server.address().port}`;
  });

  afterAll(async () => {
    await fastify.close();
    defaultBackend.close();
    chatBackend.close();
  });

  it('routes /api/tags to the host-specific backendOrigin', async () => {
    const res = await undiciRequest(baseUrl, {
      path: '/api/tags',
      method: 'GET',
      headers: { host: 'chat-app.lab' }
    });
    const body = await res.body.text();

    expect(res.statusCode).toBe(200);
    expect(body).toBe('chat:/api/tags');
    expect(chatBackend.getHits()).toBe(1);
    expect(defaultBackend.getHits()).toBe(0);
  });
});
