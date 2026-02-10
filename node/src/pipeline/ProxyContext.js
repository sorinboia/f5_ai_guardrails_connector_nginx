import { resolveConfig } from '../config/validate.js';
import { defaultStore } from '../config/store.js';
import { normalizeEnum } from '../utils/helpers.js';
import { getHeaderHost } from '../routes/helpers.js';
import { CONFIG_ENUMS, CONFIG_ENUM_ALIASES, REQUEST_PATHS_DEFAULT, RESPONSE_PATHS_DEFAULT } from '../config/constants.js';
import { isModeEnabled } from './utils.js';
import { buildStreamPlan } from './streamPlan.js';

function findPatterns(store, ids = [], context) {
  const list = Array.isArray(ids) ? ids : [];
  return list
    .map((id) => (store.patterns || []).find((p) => p.id === id && (
      p.context === context ||
      (context === 'response' && p.context === 'response_stream') ||
      (context === 'response_stream' && (p.context === 'response' || p.context === 'response_stream'))
    )))
    .filter(Boolean);
}

function buildExtractorConfig(config) {
  const requestExtractorIds = Array.isArray(config.requestExtractors) && config.requestExtractors.length
    ? config.requestExtractors
    : (config.requestExtractor ? [config.requestExtractor] : []);
  const responseExtractorIds = Array.isArray(config.responseExtractors) && config.responseExtractors.length
    ? config.responseExtractors
    : (config.responseExtractor ? [config.responseExtractor] : []);
  return { requestExtractorIds, responseExtractorIds };
}

function buildSidebandConfig(appCfg, request) {
  return {
    url: appCfg.sidebandUrl,
    bearer: appCfg.sidebandBearer || '',
    ua: appCfg.sidebandUa,
    timeout: appCfg.sidebandTimeoutMs,
    caBundle: appCfg.caBundle,
    testsLocalOverride: appCfg.testsLocalSideband,
    hostHeader: request.headers.host
  };
}

export class ProxyContext {
  constructor(fastify, request, reply) {
    this.store = fastify.store || defaultStore();
    this.appCfg = fastify.appConfig;

    const host = getHeaderHost(request);
    this.config = resolveConfig(this.store, host);
    this.stream = buildStreamPlan(this.config);

    this._initModes(request);
    this._initPatterns();
    this._initFlags(request);
    this._initBackend(request);

    this.sideband = buildSidebandConfig(this.appCfg, request);
    this._log = request.log;
    this._reply = reply;
  }

  _initModes(request) {
    const headerInspect = normalizeEnum(
      request.headers['x-sideband-inspect'],
      CONFIG_ENUMS.inspectMode,
      this.config.inspectMode
    );
    const headerRedact = normalizeEnum(
      request.headers['x-sideband-redact'],
      CONFIG_ENUMS.redactMode,
      this.config.redactMode,
      CONFIG_ENUM_ALIASES.redactMode
    );
    const headerForward = normalizeEnum(
      request.headers['x-sideband-forward'],
      CONFIG_ENUMS.requestForwardMode,
      this.config.requestForwardMode
    );

    this.modes = {
      inspect: headerInspect || this.config.inspectMode,
      redact: headerRedact || this.config.redactMode,
      requestForward: headerForward || this.config.requestForwardMode,
      headerInspect,
      headerRedact,
      headerForward
    };
  }

  _initPatterns() {
    const { requestExtractorIds, responseExtractorIds } = buildExtractorConfig(this.config);
    this.patterns = {
      request: findPatterns(this.store, requestExtractorIds, 'request'),
      response: findPatterns(this.store, responseExtractorIds, 'response'),
      requestExtractorIds,
      responseExtractorIds
    };
  }

  _initFlags(request) {
    let inspectRequestEnabled = isModeEnabled(this.modes.inspect, 'request');
    let inspectResponseEnabled = isModeEnabled(this.modes.inspect, 'response');
    let redactRequestEnabled = isModeEnabled(this.modes.redact, 'request');
    let redactResponseEnabled = isModeEnabled(this.modes.redact, 'response');

    const extractorParallelEnabled = !!(this.config.extractorParallelEnabled ?? this.config.extractorParallel);
    const wantParallel = this.modes.requestForward === 'parallel';
    const parallelRequestExtractors = extractorParallelEnabled && this.patterns.request.length > 0;
    const parallelResponseExtractors = extractorParallelEnabled && this.patterns.response.length > 0;

    if (wantParallel && inspectRequestEnabled && redactRequestEnabled) {
      request.log.info({ step: 'forward_mode:parallel_request_redaction_disabled' });
      redactRequestEnabled = false;
    }
    if (parallelRequestExtractors && redactRequestEnabled) {
      request.log.info({ step: 'extractors:parallel_request_disables_redaction' });
      redactRequestEnabled = false;
    }
    if (parallelResponseExtractors && redactResponseEnabled) {
      request.log.info({ step: 'extractors:parallel_response_disables_redaction' });
      redactResponseEnabled = false;
    }
    if (!this.stream.redactionAllowed && redactResponseEnabled) {
      request.log.info({ step: 'stream:redaction_disabled', reason: 'streaming responses are not mutated' });
      redactResponseEnabled = false;
    }
    if (!this.stream.parallelAllowed && wantParallel) {
      request.log.info({ step: 'forward_mode:passthrough_forces_sequential' });
    }

    const parallelForward = wantParallel && inspectRequestEnabled && !redactRequestEnabled && this.stream.parallelAllowed;

    this.flags = {
      inspectRequestEnabled,
      inspectResponseEnabled,
      redactRequestEnabled,
      redactResponseEnabled,
      extractorParallelEnabled,
      parallelRequestExtractors,
      parallelResponseExtractors,
      wantParallel,
      parallelForward
    };
  }

  _initBackend(request) {
    const upstreamUrl = new URL(
      request.raw.url || request.url || '/',
      this.config.backendOrigin || this.appCfg.backendOrigin
    );

    this.backend = {
      upstreamUrl,
      upstreamHost: upstreamUrl.host,
      requestUrl: request.raw.url || request.url || '/'
    };
  }

  get requestPaths() {
    return this.config.requestPaths || REQUEST_PATHS_DEFAULT;
  }

  get responsePaths() {
    return this.config.responsePaths || RESPONSE_PATHS_DEFAULT;
  }
}

/**
 * Utility to drop a passthrough stream with logging.
 * Extracted from ProxyContext to keep the class focused on context building.
 */
export function dropPassthroughStream(ctx, meta = {}) {
  ctx._log.warn({ step: 'stream:passthrough_drop', ...meta });
  if (!ctx._reply.raw.destroyed) {
    ctx._reply.raw.destroy(new Error('response_stream_blocked'));
  }
}
