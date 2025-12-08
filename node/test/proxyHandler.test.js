import { describe, it, expect, vi } from 'vitest';
import { ProxyHandler } from '../src/pipeline/proxyPipeline.js';
import { defaultStore, SCAN_CONFIG_DEFAULTS } from '../src/config/store.js';

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

describe('ProxyHandler.prepareContext', () => {
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
    const handler = new ProxyHandler(fastify);

    const ctx = handler.prepareContext(request, reply);

    expect(ctx.redactRequestEnabled).toBe(false);
    expect(ctx.parallelForward).toBe(true);
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
    const handler = new ProxyHandler(fastify);

    const ctx = handler.prepareContext(request, reply);

    expect(ctx.stream.passthrough).toBe(true);
    expect(ctx.parallelForward).toBe(false);
    expect(ctx.stream.blockingAllowed).toBe(false);
    expect(ctx.redactResponseEnabled).toBe(false);
    expect(log.info).toHaveBeenCalledWith({ step: 'forward_mode:passthrough_forces_sequential' });
    expect(log.info).toHaveBeenCalledWith({ step: 'stream:redaction_disabled', reason: 'streaming responses are not mutated' });
  });
});
