import { Transform } from 'stream';

// Prototype SSE/text-event chunker that tees the stream to the client while assembling
// overlapping chunks for later inspection/redaction. This is non-mutating; it only logs.
export function createSseChunkTee({
  chunkSize = 2048,
  overlap = 128,
  logger = null
} = {}) {
  let buffer = '';
  let chunkCount = 0;
  let bytesSeen = 0;

  const tee = new Transform({
    transform(chunk, _enc, cb) {
      // Pass-through to client
      this.push(chunk);

      // Assemble text for scanning prototype
      const text = chunk.toString('utf8');
      buffer += text;
      bytesSeen += chunk.length;

      while (buffer.length >= chunkSize) {
        // Probe only: increment counter; scanning will plug in later.
        chunkCount += 1;
        buffer = buffer.slice(chunkSize - overlap);
      }

      cb();
    },
    flush(cb) {
      if (buffer.length) chunkCount += 1;
      if (logger) {
        logger.info(
          { step: 'sse_chunk_probe', chunkSize, overlap, chunkCount, bytesSeen },
          'SSE stream chunked (probe)'
        );
      }
      cb();
    }
  });

  return tee;
}
