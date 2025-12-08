import {
  STREAM_CHUNK_OVERLAP_DEFAULT,
  STREAM_CHUNK_SIZE_DEFAULT
} from './utils.js';

const MIN_CHUNK_SIZE = 128;
const MAX_CHUNK_SIZE = 65536;

function normalizeMode(value) {
  const str = (value === undefined || value === null) ? 'buffer' : String(value).toLowerCase();
  if (str === 'passthru') return 'passthrough';
  return (str === 'passthrough' || str === 'buffer') ? str : 'buffer';
}

function clampChunkSize(raw) {
  const num = Number(raw);
  const size = Number.isFinite(num) ? num : STREAM_CHUNK_SIZE_DEFAULT;
  return Math.min(Math.max(size, MIN_CHUNK_SIZE), MAX_CHUNK_SIZE);
}

function clampOverlap(raw, chunkSize) {
  const num = Number(raw);
  const overlap = Number.isFinite(num) ? num : STREAM_CHUNK_OVERLAP_DEFAULT;
  if (overlap < 0) return 0;
  if (overlap >= chunkSize) return chunkSize > 1 ? chunkSize - 1 : 0;
  return overlap;
}

export function buildStreamPlan(config = {}) {
  const enabled = config.responseStreamEnabled !== undefined ? !!config.responseStreamEnabled : true;
  const chunkSize = clampChunkSize(config.responseStreamChunkSize);
  const chunkOverlap = clampOverlap(config.responseStreamChunkOverlap, chunkSize);
  const mode = normalizeMode(config.responseStreamBufferingMode);
  const passthrough = enabled && mode === 'passthrough';

  const finalEnabled = config.responseStreamFinalEnabled !== undefined
    ? !!config.responseStreamFinalEnabled
    : true;

  const collectFull = !!config.responseStreamCollectFullEnabled;

  return {
    enabled,
    mode,
    passthrough,
    chunkSize,
    chunkOverlap,
    collectFull,
    finalEnabled,
    gateChunks: passthrough && !!config.responseStreamChunkGatingEnabled,
    blockingAllowed: !passthrough,
    redactionAllowed: !enabled,
    parallelAllowed: !passthrough
  };
}
