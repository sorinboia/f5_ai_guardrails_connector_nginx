import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDispatcher, clearDispatcherCache } from '../src/pipeline/dispatcher.js';

vi.mock('undici', () => {
  const Agent = vi.fn(function Agent(opts) {
    this.options = opts;
  });
  return { Agent };
});

const logger = { warn: vi.fn() };

beforeEach(() => {
  clearDispatcherCache();
  vi.clearAllMocks();
});

afterEach(() => {
  clearDispatcherCache();
  vi.restoreAllMocks();
});

describe('getDispatcher', () => {
  it('returns undefined when no ca bundle provided', () => {
    const agent = getDispatcher(undefined, logger);
    expect(agent).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('caches Agent instances per ca bundle path', () => {
    const caPath = path.join(tmpdir(), `ca-${Date.now()}.crt`);
    fs.writeFileSync(caPath, 'TEST-CA');

    const first = getDispatcher(caPath, logger);
    const second = getDispatcher(caPath, logger);

    expect(first).toBe(second);
    expect(logger.warn).not.toHaveBeenCalled();
    fs.unlinkSync(caPath);
  });

  it('warns and falls back when bundle read fails', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('boom'); });

    const agent = getDispatcher('/nope/ca.crt', logger);

    expect(agent).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
