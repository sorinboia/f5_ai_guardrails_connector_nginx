import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import logsRoutes from '../../src/routes/logs.js';
import { LogRingBuffer } from '../../src/logging/logBuffer.js';

describe('logs routes', () => {
  let fastify;
  let logBuffer;

  beforeEach(async () => {
    logBuffer = new LogRingBuffer(100);
    fastify = Fastify();
    fastify.decorate('logBuffer', logBuffer);
    await fastify.register(logsRoutes);
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('GET /logs/api', () => {
    it('returns empty result when no logs', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.hasMore).toBe(false);
      expect(body.cursor).toBeNull();
    });

    it('returns logs from buffer', async () => {
      logBuffer.push({ id: 'log_1', message: 'Test log 1', level: 'info' });
      logBuffer.push({ id: 'log_2', message: 'Test log 2', level: 'warn' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.items[0].id).toBe('log_2'); // newest first
    });

    it('applies host filter', async () => {
      logBuffer.push({ id: 'log_1', host: 'api.openai.com', level: 'info' });
      logBuffer.push({ id: 'log_2', host: 'api.anthropic.com', level: 'info' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api?host=api.openai.com'
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].host).toBe('api.openai.com');
    });

    it('applies level filter', async () => {
      logBuffer.push({ id: 'log_1', level: 'info' });
      logBuffer.push({ id: 'log_2', level: 'warn' });
      logBuffer.push({ id: 'log_3', level: 'error' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api?level=warn,error'
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(2);
      expect(body.items.every(i => ['warn', 'error'].includes(i.level))).toBe(true);
    });

    it('applies status filter', async () => {
      logBuffer.push({ id: 'log_1', status: 'cleared', level: 'info' });
      logBuffer.push({ id: 'log_2', status: 'blocked', level: 'info' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api?status=blocked'
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe('blocked');
    });

    it('applies search filter', async () => {
      logBuffer.push({ id: 'log_1', message: 'Request cleared', level: 'info' });
      logBuffer.push({ id: 'log_2', message: 'PII detected', level: 'warn' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api?search=PII'
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].message).toContain('PII');
    });

    it('applies limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        logBuffer.push({ id: `log_${i}`, level: 'info' });
      }

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api?limit=3'
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(3);
      expect(body.hasMore).toBe(true);
      expect(body.total).toBe(10);
    });

    it('supports cursor pagination', async () => {
      logBuffer.push({ id: 'log_1', level: 'info' });
      logBuffer.push({ id: 'log_2', level: 'info' });
      logBuffer.push({ id: 'log_3', level: 'info' });

      const response1 = await fastify.inject({
        method: 'GET',
        url: '/logs/api?limit=2'
      });

      const body1 = JSON.parse(response1.body);
      expect(body1.items).toHaveLength(2);
      expect(body1.cursor).toBe('log_2');

      const response2 = await fastify.inject({
        method: 'GET',
        url: `/logs/api?limit=2&before=${body1.cursor}`
      });

      const body2 = JSON.parse(response2.body);
      expect(body2.items).toHaveLength(1);
      expect(body2.items[0].id).toBe('log_1');
    });

    it('returns 503 when logBuffer unavailable', async () => {
      const fastify2 = Fastify();
      await fastify2.register(logsRoutes);

      const response = await fastify2.inject({
        method: 'GET',
        url: '/logs/api'
      });

      expect(response.statusCode).toBe(503);
      await fastify2.close();
    });
  });

  describe('POST /logs/api', () => {
    it('clears logs with action: clear', async () => {
      logBuffer.push({ id: 'log_1', level: 'info' });
      logBuffer.push({ id: 'log_2', level: 'info' });

      const response = await fastify.inject({
        method: 'POST',
        url: '/logs/api',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clear' })
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.cleared).toBe(2);
      expect(logBuffer.size).toBe(0);
    });

    it('returns 400 for invalid action', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/logs/api',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'invalid' })
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('invalid_action');
    });

    it('returns 503 when logBuffer unavailable', async () => {
      const fastify2 = Fastify();
      await fastify2.register(logsRoutes);

      const response = await fastify2.inject({
        method: 'POST',
        url: '/logs/api',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clear' })
      });

      expect(response.statusCode).toBe(503);
      await fastify2.close();
    });
  });

  describe('GET /logs/api/export', () => {
    it('returns logs as downloadable JSON', async () => {
      logBuffer.push({ id: 'log_1', message: 'Test', level: 'info' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api/export'
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="guardrails-logs-.+\.json"/);

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.exported_at).toBeDefined();
    });

    it('applies filters to export', async () => {
      logBuffer.push({ id: 'log_1', level: 'info' });
      logBuffer.push({ id: 'log_2', level: 'error' });

      const response = await fastify.inject({
        method: 'GET',
        url: '/logs/api/export?level=error'
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].level).toBe('error');
    });

    it('returns 503 when logBuffer unavailable', async () => {
      const fastify2 = Fastify();
      await fastify2.register(logsRoutes);

      const response = await fastify2.inject({
        method: 'GET',
        url: '/logs/api/export'
      });

      expect(response.statusCode).toBe(503);
      await fastify2.close();
    });
  });

  describe('OPTIONS endpoints', () => {
    it('responds to OPTIONS /logs/api', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/logs/api'
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('GET');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });

    it('responds to OPTIONS /logs/api/export', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/logs/api/export'
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });

    it('responds to OPTIONS /logs/stream', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/logs/stream'
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });
  });
});
