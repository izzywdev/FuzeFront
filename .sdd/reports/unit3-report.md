# Unit 3 Report — @fuzefront/chat-client

## Status: COMPLETE

All implementation tasks complete, type-check clean, 22/22 tests passing.

---

## What was built

### Package location
`packages/chat-client/` — new directory created as specified.

### Workspace registration
- `lerna.json` packages array: `"packages/chat-client"` added.
- Root `package.json` workspaces array: `"packages/chat-client"` added.

### Source files

| File | Purpose |
|---|---|
| `src/types.ts` | ChatStreamRequest, ChatStreamEvent union (7 variants), RagSource, Conversation, ConversationMessage, ConversationWithMessages |
| `src/streaming.ts` | `parseSSEStream()` — accepts `ReadableStream<Uint8Array>` or `AsyncIterable<string>`, uses `eventsource-parser` createParser, yields `ChatStreamEvent`, stops at `{type:'done'}` |
| `src/client.ts` | `ChatServiceClient` class with `streamChat / confirmTool / listConversations / getConversation / submitFeedback` |
| `src/index.ts` | Barrel: `export * from './client'`, `'./types'`, `'./streaming'` |

### Error handling contract (as documented in client.ts)
- `streamChat`: yields a final `{type:'error', message}` event on network failure or non-2xx; does not throw. Consumers' `for await` loops see it naturally.
- All other methods: throw `Error` on non-2xx (including 401).
- `getToken() === null`: Authorization header is omitted; server 401 is surfaced as thrown error (or error event for streamChat).

### Configuration files

| File | Notes |
|---|---|
| `package.json` | name `@fuzefront/chat-client`, version `1.0.0`, MIT; exact pins: typescript 5.1.6, jest 29.7.0, ts-jest 29.1.1, @types/node 18.19.0; publishConfig → npm.pkg.github.com; repository field matches sdk shape |
| `tsconfig.json` | target ES2020, module commonjs, strict true, outDir dist, declarationMap + sourceMap |
| `jest.config.js` | ts-jest preset, testEnvironment node, roots tests/, uses tests/tsconfig.json |
| `tests/tsconfig.json` | extends ../tsconfig.json, rootDir .. to include src |

---

## Test results

Command: `cd packages/chat-client && npx jest --no-coverage`

```
PASS tests/streaming.test.ts
PASS tests/client.test.ts

Test Suites: 2 passed, 2 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        3.727 s
```

### streaming.test.ts (8 tests)
- yields a text_delta event
- yields multiple events in order (text_delta, tool_pending, rag_sources, done)
- stops after the done event
- handles event split across two chunks
- skips malformed JSON lines without throwing
- handles rag_sources event with sources array
- handles tool_pending event with args
- works with a ReadableStream<Uint8Array>

### client.test.ts (14 tests)
- streamChat: sends POST /chat/stream with auth header + correct body, yields parsed events
- streamChat: yields multiple events in order
- streamChat: yields error event on HTTP error
- streamChat: yields error event on network failure
- streamChat: no Authorization header when getToken returns null
- streamChat: includes conversationId when provided
- confirmTool: correct URL + auth header
- confirmTool: throws on 401
- listConversations: correct URL + auth + returns data
- listConversations: throws on 401
- getConversation: correct URL + auth
- getConversation: throws on 401
- submitFeedback: correct URL + body + auth
- submitFeedback: throws on 500

---

## Type-check

Command: `npx tsc --noEmit` — clean (zero errors).

---

## Build

Command: `npx tsc` — clean. `dist/` contains `.js`, `.d.ts`, `.js.map`, `.d.ts.map` for all four modules.

---

## Dependency install

`npm install` run inside `packages/chat-client/`. Installed `eventsource-parser ^1.1.2` and all dev deps. Resolved 6 packages.

---

## Concerns / Notes

- `eventsource-parser` v1.x API: `createParser(callback)` with `ParsedEvent | ReconnectInterval` callback shape was used exactly as the v1 public API specifies. No breaking-change risk vs v2 (which changed the API).
- Node 18 Web Streams API (`ReadableStream`, `TextEncoder`/`TextDecoder`) is available natively; no polyfill required.
- `strict: true` required two places where email-service uses `strict: false` — these are intentional deviations per the brief ("strict true").
- The `dist/` directory is committed here for visibility; in production it should be built by CI before publish.
