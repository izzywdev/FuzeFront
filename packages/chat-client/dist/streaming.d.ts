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
import type { ChatStreamEvent } from './types';
type SSEInput = ReadableStream<Uint8Array> | AsyncIterable<string>;
/**
 * Parse an SSE byte stream (or string iterable) and yield typed `ChatStreamEvent` objects.
 *
 * @param input  A `ReadableStream<Uint8Array>` from `fetch().body`, or an
 *               `AsyncIterable<string>` for testing.
 */
export declare function parseSSEStream(input: SSEInput): AsyncGenerator<ChatStreamEvent>;
export {};
//# sourceMappingURL=streaming.d.ts.map