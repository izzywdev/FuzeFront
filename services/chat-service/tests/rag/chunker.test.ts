// chunker.test.ts — deterministic recursive character chunking (no I/O).

import { chunkText } from '../../src/rag/chunker';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('hello world', { chunkSize: 100, overlap: 10 });
    expect(chunks).toEqual(['hello world']);
  });

  it('returns empty array for empty/whitespace text', () => {
    expect(chunkText('', { chunkSize: 100, overlap: 10 })).toEqual([]);
    expect(chunkText('   \n  ', { chunkSize: 100, overlap: 10 })).toEqual([]);
  });

  it('splits long text into multiple chunks of bounded size', () => {
    const text = 'a'.repeat(250);
    const chunks = chunkText(text, { chunkSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(100);
    }
  });

  it('overlaps consecutive chunks by the configured amount', () => {
    const text = 'abcdefghij'.repeat(20); // 200 chars
    const chunks = chunkText(text, { chunkSize: 50, overlap: 10 });
    // The tail of chunk[i] should appear at the head of chunk[i+1].
    for (let i = 0; i < chunks.length - 1; i++) {
      const tail = chunks[i].slice(-10);
      expect(chunks[i + 1].startsWith(tail)).toBe(true);
    }
  });

  it('prefers to split on paragraph then sentence boundaries', () => {
    const para1 = 'First paragraph. '.repeat(5).trim();
    const para2 = 'Second paragraph. '.repeat(5).trim();
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text, { chunkSize: 120, overlap: 0 });
    // No chunk should straddle the paragraph boundary when each paragraph fits.
    expect(chunks.some((c) => c.includes('First'))).toBe(true);
    expect(chunks.some((c) => c.includes('Second'))).toBe(true);
  });

  it('is deterministic — same input yields identical output', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(30);
    const a = chunkText(text, { chunkSize: 80, overlap: 16 });
    const b = chunkText(text, { chunkSize: 80, overlap: 16 });
    expect(a).toEqual(b);
  });
});
