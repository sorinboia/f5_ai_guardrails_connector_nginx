import { describe, it, expect, vi } from 'vitest';
import { createSseChunkTee } from '../src/pipeline/streaming.js';

describe('createSseChunkTee', () => {
  it('passes through data while counting overlapping chunks', async () => {
    const logger = { info: vi.fn() };
    const tee = createSseChunkTee({ chunkSize: 4, overlap: 1, logger });

    const output = [];
    tee.on('data', (buf) => output.push(buf.toString('utf8')));

    tee.write('abcd');
    tee.write('ef');
    tee.write('ghij');
    tee.end();

    await new Promise((resolve) => tee.on('finish', resolve));

    // Expect overlapping chunk windowing: buffer lengths trigger 4 chunks total.
    expect(logger.info).toHaveBeenCalledWith(
      { step: 'sse_chunk_probe', chunkSize: 4, overlap: 1, chunkCount: 4, bytesSeen: 10 },
      'SSE stream chunked (probe)'
    );
    expect(output.join('')).toBe('abcdefghij');
  });
});
