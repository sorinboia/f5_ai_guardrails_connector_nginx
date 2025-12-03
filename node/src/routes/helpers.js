import { normalizeHostName } from '../config/validate.js';

export function getHeaderHost(request) {
  const hdr = request.headers['x-guardrails-config-host'];
  if (hdr !== undefined && hdr !== null && hdr !== '') return normalizeHostName(hdr);
  const host = request.headers.host;
  if (host) return normalizeHostName(host);
  return normalizeHostName('__default__');
}

export function ensureHeaderMatchesHost(request, targetHost) {
  const headerHost = getHeaderHost(request);
  const target = normalizeHostName(targetHost);
  if (target === '__default__' && headerHost === '__default__') return { ok: true, headerHost };
  if (target === headerHost) return { ok: true, headerHost };
  return { ok: false, headerHost };
}

export function respondJson(reply, status, payload, allow = '') {
  reply
    .code(status)
    .header('content-type', 'application/json; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('access-control-allow-origin', '*');
  if (allow) {
    reply.header('allow', allow);
    reply.header('access-control-allow-methods', allow);
  }
  return reply.send(payload);
}

export function optionsReply(reply, allow, allowHeaders) {
  reply
    .code(204)
    .header('access-control-allow-origin', '*')
    .header('access-control-allow-methods', allow)
    .header('access-control-allow-headers', allowHeaders)
    .header('access-control-max-age', '300')
    .header('allow', allow);
  return reply.send();
}
