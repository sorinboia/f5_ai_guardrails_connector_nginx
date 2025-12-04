import { describe, it, expect } from 'vitest';
import {
  extractSegments,
  sliceTextChunks,
  parseStreamingBody,
  buildStreamMessageBody
} from '../src/pipeline/utils.js';

describe('extractSegments', () => {
  it('extracts stringified values and tracks offsets', () => {
    const root = { a: 'foo', b: 42 };
    const result = extractSegments(root, ['.a', '.b'], ' ');
    expect(result.text).toBe('foo 42 ');
    expect(result.segments).toEqual([
      { path: '.a', start: 0, end: 3, length: 3, valueType: 'string' },
      { path: '.b', start: 4, end: 6, length: 2, valueType: 'number' },
    ]);
  });
});

describe('sliceTextChunks', () => {
  it('creates overlapping windows and clamps overlap to size-1', () => {
    const chunks = sliceTextChunks('abcdefghij', 4, 1);
    expect(chunks).toEqual(['abcd', 'defg', 'ghij']);
  });
});

describe('parseStreamingBody', () => {
  it('assembles SSE data lines and ignores DONE/heartbeat', () => {
    const body = [
      ': keep-alive',
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      'data: {"choices":[{"delta":{"content":"World"}}]}',
      'data: [DONE]'
    ].join('\n');

    const parsed = parseStreamingBody(body, { 'content-type': 'text/event-stream' });
    expect(parsed.events).toBe(2);
    expect(parsed.assembled).toBe('Hello World');
    expect(buildStreamMessageBody(parsed.assembled)).toBe('{"message":{"content":"Hello World"}}');
  });
});
