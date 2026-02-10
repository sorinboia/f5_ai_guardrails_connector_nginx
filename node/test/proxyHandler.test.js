import { describe, it, expect, vi } from 'vitest';
import { ProxyContext } from '../src/pipeline/ProxyContext.js';
import { defaultStore } from '../src/config/store.js';
import { SCAN_CONFIG_DEFAULTS } from '../src/config/constants.js';

const baseAppConfig = {
  backendOrigin: 'https://example.com',
  sidebandUrl: 'http://sideband.local',
  sidebandBearer: 'token',
  sidebandUa: 'ua/1.0',
  sidebandTimeoutMs: 1000,
  caBundle: null,
  testsLocalSideband: false
};

function fakeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

function makeFastify(storeOverrides = {}, appOverrides = {}) {
  const base = defaultStore();
  const mergedHostConfig = {
    ...base.hostConfigs.__default__,
    ...(storeOverrides.hostConfigs?.__default__ || {})
  };
  const store = {
    ...base,
    ...storeOverrides,
    hostConfigs: { __default__: mergedHostConfig }
  };
  return {
    store,
    appConfig: { ...baseAppConfig, ...appOverrides },
    saveStore: vi.fn()
  };
}

function makeReqRes(log = fakeLog()) {
  const request = { headers: { host: 'example.com' }, raw: { url: '/api' }, url: '/api', method: 'POST', log };
  const reply = { raw: { destroyed: false }, code: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis(), send: vi.fn() };
  return { request, reply };
}

describe('ProxyContext', () => {
  it('disables request redaction when parallel forward is enabled with inspection', () => {
    const log = fakeLog();
    const { request, reply } = makeReqRes(log);
    const fastify = makeFastify({
      hostConfigs: {
        __default__: {
          ...SCAN_CONFIG_DEFAULTS,
          requestForwardMode: 'parallel',
          inspectMode: 'both',
          redactMode: 'both'
        }
      }
    });

    const ctx = new ProxyContext(fastify, request, reply);

    expect(ctx.flags.redactRequestEnabled).toBe(false);
    expect(ctx.flags.parallelForward).toBe(true);
    expect(log.info).toHaveBeenCalledWith({ step: 'forward_mode:parallel_request_redaction_disabled' });
  });

  it('forces sequential mode when streaming passthrough is enabled', () => {
    const log = fakeLog();
    const { request, reply } = makeReqRes(log);
    const fastify = makeFastify({
      hostConfigs: {
        __default__: {
          ...SCAN_CONFIG_DEFAULTS,
          requestForwardMode: 'parallel',
          responseStreamBufferingMode: 'passthrough',
          redactMode: 'both'
        }
      }
    });

    const ctx = new ProxyContext(fastify, request, reply);

    expect(ctx.stream.passthrough).toBe(true);
    expect(ctx.flags.parallelForward).toBe(false);
    expect(ctx.stream.blockingAllowed).toBe(false);
    expect(ctx.flags.redactResponseEnabled).toBe(false);
    expect(log.info).toHaveBeenCalledWith({ step: 'forward_mode:passthrough_forces_sequential' });
    expect(log.info).toHaveBeenCalledWith({ step: 'stream:redaction_disabled', reason: 'streaming responses are not mutated' });
  });
});
