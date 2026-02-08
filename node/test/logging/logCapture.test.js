import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLogCapture,
  createLogCaptureHook,
  shouldCapture,
  determinePhase,
  determineStatus,
  toLogEntry,
  normalizeLevel
} from '../../src/logging/logCapture.js';
import { LogRingBuffer } from '../../src/logging/logBuffer.js';

describe('logCapture', () => {
  describe('normalizeLevel', () => {
    it('converts numeric Pino levels', () => {
      expect(normalizeLevel(10)).toBe('debug'); // trace -> debug
      expect(normalizeLevel(20)).toBe('debug');
      expect(normalizeLevel(30)).toBe('info');
      expect(normalizeLevel(40)).toBe('warn');
      expect(normalizeLevel(50)).toBe('error');
      expect(normalizeLevel(60)).toBe('error'); // fatal -> error
    });

    it('handles string levels', () => {
      expect(normalizeLevel('debug')).toBe('debug');
      expect(normalizeLevel('info')).toBe('info');
      expect(normalizeLevel('warn')).toBe('warn');
      expect(normalizeLevel('error')).toBe('error');
    });

    it('defaults to info for unknown levels', () => {
      expect(normalizeLevel('unknown')).toBe('info');
      expect(normalizeLevel(999)).toBe('info');
    });
  });

  describe('shouldCapture', () => {
    it('captures warn level logs', () => {
      expect(shouldCapture({ level: 40 })).toBe(true);
      expect(shouldCapture({ level: 'warn' })).toBe(true);
    });

    it('captures error level logs', () => {
      expect(shouldCapture({ level: 50 })).toBe(true);
      expect(shouldCapture({ level: 'error' })).toBe(true);
    });

    it('captures request:* steps', () => {
      expect(shouldCapture({ level: 30, step: 'request:inspection' })).toBe(true);
      expect(shouldCapture({ level: 30, step: 'request:blocked' })).toBe(true);
    });

    it('captures response:* steps', () => {
      expect(shouldCapture({ level: 30, step: 'response:inspection' })).toBe(true);
      expect(shouldCapture({ level: 30, step: 'response:cleared' })).toBe(true);
    });

    it('captures stream:* steps', () => {
      expect(shouldCapture({ level: 30, step: 'stream:chunk' })).toBe(true);
      expect(shouldCapture({ level: 30, step: 'stream:passthrough_drop' })).toBe(true);
    });

    it('captures proxy:* steps', () => {
      expect(shouldCapture({ level: 30, step: 'proxy:error' })).toBe(true);
      expect(shouldCapture({ level: 30, step: 'proxy:fallback' })).toBe(true);
    });

    it('captures sideband:* steps', () => {
      expect(shouldCapture({ level: 30, step: 'sideband:request' })).toBe(true);
      expect(shouldCapture({ level: 30, step: 'sideband:response' })).toBe(true);
    });

    it('does not capture info logs without matching step', () => {
      expect(shouldCapture({ level: 30, step: 'server:start' })).toBe(false);
      expect(shouldCapture({ level: 30, msg: 'just a message' })).toBe(false);
    });

    it('does not capture debug logs without matching step', () => {
      expect(shouldCapture({ level: 20, step: 'unknown:step' })).toBe(false);
    });
  });

  describe('determinePhase', () => {
    it('maps request steps to request phase', () => {
      expect(determinePhase('request:inspection')).toBe('request');
      expect(determinePhase('request:blocked')).toBe('request');
    });

    it('maps response steps to response phase', () => {
      expect(determinePhase('response:inspection')).toBe('response');
      expect(determinePhase('response:cleared')).toBe('response');
    });

    it('maps stream steps to response_stream phase', () => {
      expect(determinePhase('stream:chunk')).toBe('response_stream');
      expect(determinePhase('stream:passthrough')).toBe('response_stream');
    });

    it('maps proxy steps to proxy phase', () => {
      expect(determinePhase('proxy:error')).toBe('proxy');
      expect(determinePhase('proxy:fallback')).toBe('proxy');
    });

    it('maps sideband steps to request phase', () => {
      expect(determinePhase('sideband:request')).toBe('request');
      expect(determinePhase('sideband:response')).toBe('request');
    });

    it('defaults to proxy for unknown steps', () => {
      expect(determinePhase('unknown:step')).toBe('proxy');
      expect(determinePhase('')).toBe('proxy');
      expect(determinePhase(null)).toBe('proxy');
    });
  });

  describe('determineStatus', () => {
    it('returns error for error level logs', () => {
      expect(determineStatus({ level: 50, step: 'request:test' })).toBe('error');
    });

    it('detects blocked status', () => {
      expect(determineStatus({ level: 30, step: 'request:blocked' })).toBe('blocked');
      expect(determineStatus({ level: 30, outcome: 'flagged' })).toBe('blocked');
    });

    it('detects redacted status', () => {
      expect(determineStatus({ level: 30, step: 'request:redacted' })).toBe('redacted');
      expect(determineStatus({ level: 30, message: 'Content was redacted' })).toBe('redacted');
    });

    it('detects cleared status', () => {
      expect(determineStatus({ level: 30, step: 'request:cleared' })).toBe('cleared');
      expect(determineStatus({ level: 30, outcome: 'passed' })).toBe('cleared');
    });

    it('detects skipped status', () => {
      expect(determineStatus({ level: 30, step: 'request:skipped' })).toBe('skipped');
      expect(determineStatus({ level: 30, message: 'Inspection disabled' })).toBe('skipped');
    });

    it('detects error status from messages', () => {
      expect(determineStatus({ level: 30, step: 'proxy:error' })).toBe('error');
      expect(determineStatus({ level: 30, message: 'Connection failed' })).toBe('error');
    });

    it('defaults to cleared for info logs', () => {
      expect(determineStatus({ level: 30, step: 'request:test' })).toBe('cleared');
    });

    it('defaults to error for warn logs', () => {
      expect(determineStatus({ level: 40, step: 'request:test' })).toBe('error');
    });
  });

  describe('toLogEntry', () => {
    it('creates a complete log entry', () => {
      const logObj = {
        level: 30,
        time: 1704067200000, // 2024-01-01T00:00:00.000Z
        step: 'request:inspection',
        trace_id: 'trace123',
        host: 'api.openai.com',
        url: '/v1/chat/completions',
        method: 'POST',
        pattern_id: 'pat_123',
        pattern_name: 'PII Detection',
        api_key_name: 'default',
        message: 'Request inspection completed',
        outcome: 'cleared',
        extra_field: 'extra_value'
      };

      const entry = toLogEntry(logObj);

      expect(entry.id).toMatch(/^log_\d+_[a-z0-9]+$/);
      expect(entry.timestamp).toBe('2024-01-01T00:00:00.000Z');
      expect(entry.trace_id).toBe('trace123');
      expect(entry.host).toBe('api.openai.com');
      expect(entry.phase).toBe('request');
      expect(entry.status).toBe('cleared');
      expect(entry.pattern_id).toBe('pat_123');
      expect(entry.pattern_name).toBe('PII Detection');
      expect(entry.api_key_name).toBe('default');
      expect(entry.url).toBe('/v1/chat/completions');
      expect(entry.method).toBe('POST');
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Request inspection completed');
      expect(entry.details.extra_field).toBe('extra_value');
      expect(entry.details.outcome).toBe('cleared');
    });

    it('handles minimal log object', () => {
      const entry = toLogEntry({ level: 30 });

      expect(entry.id).toMatch(/^log_\d+_[a-z0-9]+$/);
      expect(entry.timestamp).toBeDefined();
      expect(entry.trace_id).toBe('');
      expect(entry.host).toBe('');
      expect(entry.phase).toBe('proxy');
      expect(entry.status).toBe('cleared');
      expect(entry.url).toBe('');
      expect(entry.method).toBe('');
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Log entry');
    });

    it('extracts trace_id from reqId', () => {
      const entry = toLogEntry({ level: 30, reqId: 'req123' });
      expect(entry.trace_id).toBe('req123');
    });

    it('extracts url from req object', () => {
      const entry = toLogEntry({ level: 30, req: { url: '/test', method: 'GET' } });
      expect(entry.url).toBe('/test');
      expect(entry.method).toBe('GET');
    });

    it('uses msg if message is not present', () => {
      const entry = toLogEntry({ level: 30, msg: 'Using msg field' });
      expect(entry.message).toBe('Using msg field');
    });

    it('excludes details if empty', () => {
      const entry = toLogEntry({ level: 30, msg: 'test' });
      expect(entry.details).toBeUndefined();
    });
  });

  describe('createLogCapture', () => {
    let buffer;
    let capture;

    beforeEach(() => {
      buffer = new LogRingBuffer(100);
      capture = createLogCapture(buffer, { alsoLog: false });
    });

    it('captures matching log lines', async () => {
      const logLine = JSON.stringify({
        level: 40,
        time: Date.now(),
        step: 'request:blocked',
        message: 'Request blocked'
      }) + '\n';

      await new Promise((resolve) => {
        capture.write(logLine, 'utf8', resolve);
      });

      expect(buffer.size).toBe(1);
      expect(buffer.entries[0].status).toBe('blocked');
    });

    it('ignores non-matching log lines', async () => {
      const logLine = JSON.stringify({
        level: 30,
        time: Date.now(),
        step: 'server:start',
        message: 'Server started'
      }) + '\n';

      await new Promise((resolve) => {
        capture.write(logLine, 'utf8', resolve);
      });

      expect(buffer.size).toBe(0);
    });

    it('handles non-JSON lines gracefully', async () => {
      await new Promise((resolve) => {
        capture.write('not json\n', 'utf8', resolve);
      });

      expect(buffer.size).toBe(0);
    });
  });

  describe('createLogCaptureHook', () => {
    let buffer;
    let hook;

    beforeEach(() => {
      buffer = new LogRingBuffer(100);
      hook = createLogCaptureHook(buffer);
    });

    it('captures matching log objects', () => {
      hook({
        level: 50,
        step: 'proxy:error',
        message: 'Connection failed'
      });

      expect(buffer.size).toBe(1);
      expect(buffer.entries[0].level).toBe('error');
    });

    it('ignores non-matching log objects', () => {
      hook({
        level: 30,
        step: 'server:ready',
        message: 'Server ready'
      });

      expect(buffer.size).toBe(0);
    });
  });
});
