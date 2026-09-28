import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entry points: the Node SDK (`@fuzefront/telemetry`) and the browser SDK
  // (`@fuzefront/telemetry/browser`). They pull in disjoint OTel packages
  // (Node's `sdk-node`/gRPC exporter vs. the browser's `sdk-trace-web`/fetch
  // instrumentation) and must never end up in the same bundle — a Node-only
  // module (e.g. `@opentelemetry/exporter-trace-otlp-grpc`, which needs `@grpc/
  // grpc-js`) reaching a browser bundle would break the build or ship dead
  // weight; the reverse would pull DOM-only globals into a server bundle.
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  // express is an optional peer — never bundle it. All @opentelemetry/* deps
  // are regular `dependencies` (see package.json), which tsup externalizes by
  // default, so they are not listed here.
  external: ['express'],
});
