import fs from 'fs';
import { Agent, fetch } from 'undici';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_UA = 'njs-sideband/1.0';

const agentCache = new Map();

function getDispatcher(caBundle, logger) {
  if (!caBundle) return undefined;
  if (agentCache.has(caBundle)) return agentCache.get(caBundle);

  try {
    const ca = fs.readFileSync(caBundle, 'utf8');
    const agent = new Agent({ connect: { ca } });
    agentCache.set(caBundle, agent);
    return agent;
  } catch (err) {
    logger?.warn({ err, caBundle }, 'Failed to load CA bundle; using default trust store');
    return undefined;
  }
}

export async function callSideband({
  url,
  bearer,
  payload,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  caBundle,
  testsLocalOverride,
  hostHeader,
  logger,
  ua = DEFAULT_UA
}) {
  const targetUrl = (hostHeader && hostHeader.toLowerCase() === 'tests.local' && testsLocalOverride)
    ? testsLocalOverride
    : url;

  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': ua || DEFAULT_UA,
    authorization: `Bearer ${bearer}`
  };

  logger?.debug(
    { step: 'sideband:request', url: targetUrl, headers: { ...headers, authorization: '[redacted]' } },
    'Calling Guardrails sideband'
  );

  const controller = new AbortController();
  const timeout = Number(timeoutMs) > 0 ? setTimeout(() => controller.abort(), Number(timeoutMs)) : null;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
      dispatcher: getDispatcher(caBundle, logger)
    });

    let text = '';
    try {
      text = await response.text();
    } catch (_) {
      text = '';
    }

    logger?.debug(
      { step: 'sideband:response', status: response.status, preview: text.slice(0, 200) },
      'Guardrails sideband response'
    );

    return { status: response.status, text };
  } catch (err) {
    const name = err?.name || '';
    const status = name === 'AbortError' ? 599 : 599;
    logger?.warn(
      { step: 'sideband:error', error: err?.message || String(err), timeout_ms: timeoutMs },
      'Guardrails sideband call failed'
    );
    return { status, text: '' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
