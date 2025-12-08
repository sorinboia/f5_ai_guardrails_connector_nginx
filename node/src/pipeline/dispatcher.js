import fs from 'fs';
import { Agent } from 'undici';

const dispatcherCache = new Map();

export function getDispatcher(caBundle, logger) {
  if (!caBundle) return undefined;
  if (dispatcherCache.has(caBundle)) return dispatcherCache.get(caBundle);

  try {
    const ca = fs.readFileSync(caBundle, 'utf8');
    const agent = new Agent({ connect: { ca } });
    dispatcherCache.set(caBundle, agent);
    return agent;
  } catch (err) {
    logger?.warn({ err, caBundle }, 'Failed to load CA bundle; using default trust store');
    return undefined;
  }
}

export function clearDispatcherCache() {
  dispatcherCache.clear();
}
