// jest's `jsdom` test environment (used by `browser.test.ts` via a
// `@jest-environment jsdom` docblock) does not provide `TextEncoder`/
// `TextDecoder` on its global scope, unlike a real browser or Node — and
// `@opentelemetry/instrumentation-fetch` constructs a `TextEncoder` at module
// load time. Polyfill from Node's `util` before any test file's imports run.
// A no-op under the default `node` environment, which already has these.
if (typeof globalThis.TextEncoder === 'undefined' || typeof globalThis.TextDecoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}
