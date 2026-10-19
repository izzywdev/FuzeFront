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
// Transports: SSE & WebSocket
// ---------------------------------------------------------------------------

import type { StreamingTransport, ChatStreamRequest } from './types';

/**
 * Default HTTP Server-Sent Events (SSE) Transport.
 */
export class SseTransport implements StreamingTransport {
  async *stream(
    req: ChatStreamRequest,
    endpointUrl: string,
    headers: Record<string, string>,
  ): AsyncIterable<ChatStreamEvent> {
    let res: Response;
    try {
      res = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...headers,
        },
        body: JSON.stringify(req),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
      return;
    }

    if (!res.ok) {
      yield { type: 'error', message: `HTTP ${res.status}: ${res.statusText}` };
      return;
    }

    if (!res.body) {
      yield { type: 'error', message: 'Response body is null' };
      return;
    }

    yield* parseSSEStream(res.body);
  }
}

/**
 * Low-latency WebSocket Transport for bidirectional agent streaming.
 */
export class WebSocketTransport implements StreamingTransport {
  private readonly wsUrlFactory?: (baseUrl: string, req: ChatStreamRequest) => string;

  constructor(wsUrlFactory?: (baseUrl: string, req: ChatStreamRequest) => string) {
    this.wsUrlFactory = wsUrlFactory;
  }

  async *stream(
    req: ChatStreamRequest,
    endpointUrl: string,
    headers: Record<string, string>,
  ): AsyncIterable<ChatStreamEvent> {
    // Resolve ws:// or wss:// URL from http(s) URL
    let wsUrl: string;
    if (this.wsUrlFactory) {
      wsUrl = this.wsUrlFactory(endpointUrl, req);
    } else {
      wsUrl = endpointUrl.replace(/^http(s)?:\/\//, (_, secure) => (secure ? 'wss://' : 'ws://'));
      if (!wsUrl.includes('/ws')) {
        wsUrl = wsUrl.replace(/\/chat\/stream$/, '/ws/chat/stream');
      }
    }

    // Buffer for asynchronously arriving WebSocket events
    const queue: ChatStreamEvent[] = [];
    let isDone = false;
    let notifyResolver: (() => void) | null = null;

    const pushEvent = (evt: ChatStreamEvent) => {
      queue.push(evt);
      if (evt.type === 'done' || evt.type === 'error') {
        isDone = true;
      }
      if (notifyResolver) {
        notifyResolver();
        notifyResolver = null;
      }
    };

    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              action: 'stream_chat',
              headers,
              ...req,
            })
          );
        }
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as ChatStreamEvent;
          pushEvent(parsed);
        } catch {
          // ignore non-json messages
        }
      };

      socket.onerror = (ev) => {
        pushEvent({ type: 'error', message: 'WebSocket connection failed' });
      };

      socket.onclose = () => {
        if (!isDone) {
          pushEvent({ type: 'done' });
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
      return;
    }

    try {
      while (!isDone || queue.length > 0) {
        if (queue.length > 0) {
          const nextEvt = queue.shift()!;
          yield nextEvt;
          if (nextEvt.type === 'done') break;
        } else if (!isDone) {
          await new Promise<void>((resolve) => {
            notifyResolver = resolve;
          });
        }
      }
    } finally {
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
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
