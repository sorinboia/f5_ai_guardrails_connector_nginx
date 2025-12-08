import { describe, it, expect } from 'vitest';
import { buildStreamPlan } from '../src/pipeline/streamPlan.js';

describe('buildStreamPlan', () => {
  it('clamps overlap to below chunk size and leaves buffering mode at buffer', () => {
    const plan = buildStreamPlan({
      responseStreamEnabled: true,
      responseStreamChunkSize: 256,
      responseStreamChunkOverlap: 300,
      responseStreamBufferingMode: 'buffer',
      responseStreamFinalEnabled: true
    });

    expect(plan.chunkSize).toBe(256);
    expect(plan.chunkOverlap).toBe(255);
    expect(plan.passthrough).toBe(false);
    expect(plan.blockingAllowed).toBe(true);
    expect(plan.gateChunks).toBe(false);
  });

  it('enforces passthrough-only gating and disables response redaction', () => {
    const plan = buildStreamPlan({
      responseStreamEnabled: true,
      responseStreamBufferingMode: 'passthrough',
      responseStreamChunkGatingEnabled: true
    });

    expect(plan.passthrough).toBe(true);
    expect(plan.gateChunks).toBe(true);
    expect(plan.blockingAllowed).toBe(false);
    expect(plan.redactionAllowed).toBe(false);
    expect(plan.parallelAllowed).toBe(false);

    const disabled = buildStreamPlan({ responseStreamEnabled: false, responseStreamChunkGatingEnabled: true });
    expect(disabled.gateChunks).toBe(false);
    expect(disabled.redactionAllowed).toBe(true);
  });
});
