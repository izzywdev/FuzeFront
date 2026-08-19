/**
 * Unit tests for parseSSEStream (streaming.ts).
 *
 * Uses async iterables of pre-built SSE text chunks so no network I/O occurs.
 * The only real dependency is eventsource-parser — fetch is not involved.
 */

import { parseSSEStream } from '../src/streaming';
import type { ChatStreamEvent } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an array of string chunks into an AsyncIterable<string>. */
async function* chunksToIterable(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Collect all events from the generator into an array. */
async function collect(input: AsyncIterable<string>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const evt of parseSSEStream(input)) {
    events.push(evt);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEXT_DELTA_LINE = `data: ${JSON.stringify({ type: 'text_delta', delta: 'Hello' })}\n\n`;
const TOOL_PENDING_LINE = `data: ${JSON.stringify({
  type: 'tool_pending',
  confirmationId: 'c1',
  toolName: 'search',
  args: { q: 'test' },
  description: 'Search the web',
})}\n\n`;
const RAG_SOURCES_LINE = `data: ${JSON.stringify({
  type: 'rag_sources',
  sources: [{ title: 'Doc', url: 'https://example.com', excerpt: 'Some text' }],
})}\n\n`;
const DONE_LINE = `data: ${JSON.stringify({ type: 'done' })}\n\n`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSSEStream', () => {
  it('yields a text_delta event', async () => {
    const events = await collect(chunksToIterable([TEXT_DELTA_LINE]));
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
  });

  it('yields multiple events in order', async () => {
    const sseText = TEXT_DELTA_LINE + TOOL_PENDING_LINE + RAG_SOURCES_LINE + DONE_LINE;
    const events = await collect(chunksToIterable([sseText]));

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events[1]).toMatchObject({ type: 'tool_pending', confirmationId: 'c1', toolName: 'search' });
    expect(events[2]).toMatchObject({ type: 'rag_sources' });
    expect(events[3]).toEqual({ type: 'done' });
  });

  it('stops after the done event', async () => {
    // A text_delta after done should NOT be yielded
    const sseText =
      TEXT_DELTA_LINE +
      DONE_LINE +
      `data: ${JSON.stringify({ type: 'text_delta', delta: 'After done' })}\n\n`;

    const events = await collect(chunksToIterable([sseText]));

    // Should stop at done — text_delta after done is not yielded
    const doneIndex = events.findIndex((e) => e.type === 'done');
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(events.slice(doneIndex + 1)).toHaveLength(0);
  });

  it('handles an event split across two chunks', async () => {
    // Split the data line mid-way
    const full = `data: ${JSON.stringify({ type: 'text_delta', delta: 'Split' })}\n\n`;
    const mid = Math.floor(full.length / 2);
    const chunk1 = full.slice(0, mid);
    const chunk2 = full.slice(mid);

    const events = await collect(chunksToIterable([chunk1, chunk2]));
    expect(events).toEqual([{ type: 'text_delta', delta: 'Split' }]);
  });

  it('skips malformed JSON lines without throwing', async () => {
    const badLine = 'data: not-valid-json\n\n';
    const events = await collect(chunksToIterable([badLine, TEXT_DELTA_LINE]));
    // The malformed line is skipped; the valid one is yielded
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
  });

  it('handles rag_sources event with sources array', async () => {
    const events = await collect(chunksToIterable([RAG_SOURCES_LINE]));
    expect(events).toHaveLength(1);
    const evt = events[0] as Extract<ChatStreamEvent, { type: 'rag_sources' }>;
    expect(evt.type).toBe('rag_sources');
    expect(evt.sources[0].title).toBe('Doc');
  });

  it('handles tool_pending event with args', async () => {
    const events = await collect(chunksToIterable([TOOL_PENDING_LINE]));
    expect(events).toHaveLength(1);
    const evt = events[0] as Extract<ChatStreamEvent, { type: 'tool_pending' }>;
    expect(evt.type).toBe('tool_pending');
    expect(evt.confirmationId).toBe('c1');
    expect(evt.args).toEqual({ q: 'test' });
  });

  it('works with a ReadableStream<Uint8Array>', async () => {
    const sseText = TEXT_DELTA_LINE + DONE_LINE;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(sseText);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const events: ChatStreamEvent[] = [];
    for await (const evt of parseSSEStream(stream)) {
      events.push(evt);
    }

    expect(events[0]).toEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events[1]).toEqual({ type: 'done' });
  });
});
