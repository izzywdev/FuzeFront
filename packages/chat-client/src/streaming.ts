/**
 * SSE stream parser for the FuzeFront chat-service.
 *
 * Accepts either a Web Streams `ReadableStream<Uint8Array>` (the raw fetch response body)
 * or an async iterable of pre-decoded strings (useful for unit-testing with mocked chunks).
 *
 * Each SSE `data:` line is expected to be a JSON object whose shape is `ChatStreamEvent`.
 * The generator yields every parsed event and stops after the first `{type:'done'}` event.
 *
 * Malformed JSON in a `data:` line is silently skipped so that comments / keep-alive
 * `: ping` lines do not abort the stream.
 */

import { createParser } from 'eventsource-parser';
import type { ParsedEvent, ReconnectInterval } from 'eventsource-parser';
import type { ChatStreamEvent } from './types';

type SSEInput = ReadableStream<Uint8Array> | AsyncIterable<string>;

/**
 * Parse an SSE byte stream (or string iterable) and yield typed `ChatStreamEvent` objects.
 *
 * @param input  A `ReadableStream<Uint8Array>` from `fetch().body`, or an
 *               `AsyncIterable<string>` for testing.
 */
export async function* parseSSEStream(input: SSEInput): AsyncGenerator<ChatStreamEvent> {
  // Buffer for events resolved synchronously by the parser callback
  const eventQueue: ChatStreamEvent[] = [];

  const parser = createParser((event: ParsedEvent | ReconnectInterval) => {
    if (event.type !== 'event') return;
    const raw = event.data;
    if (!raw || raw === '[DONE]') return;
    try {
      const parsed = JSON.parse(raw) as ChatStreamEvent;
      eventQueue.push(parsed);
    } catch {
      // skip malformed / keep-alive lines
    }
  });

  const decoder = new TextDecoder();

  // Obtain an async iterable of string chunks
  const chunks: AsyncIterable<string> = isReadableStream(input)
    ? readableStreamToStringIterable(input, decoder)
    : input;

  for await (const chunk of chunks) {
    parser.feed(chunk);

    // Drain all events that the parser emitted synchronously for this chunk
    while (eventQueue.length > 0) {
      const evt = eventQueue.shift()!;
      yield evt;
      if (evt.type === 'done') return;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isReadableStream(value: SSEInput): value is ReadableStream<Uint8Array> {
  return typeof (value as ReadableStream).getReader === 'function';
}

async function* readableStreamToStringIterable(
  stream: ReadableStream<Uint8Array>,
  decoder: TextDecoder,
): AsyncIterable<string> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    // Flush remaining bytes
    const tail = decoder.decode(undefined, { stream: false });
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
