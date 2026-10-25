/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_WS_URL: string
  // Node-style env exposed by some tooling; not a standard Vite key, so it must
  // be declared explicitly (DEV/PROD/MODE/BASE_URL come from `vite/client`).
  readonly NODE_ENV?: string
  // Overrides the SW update-check poll interval (ms); see
  // registerServiceWorker.ts. Optional — defaults to 60s.
  readonly VITE_SW_UPDATE_INTERVAL_MS?: string
  // OTLP/HTTP endpoint for browser tracing (see main.tsx's
  // initBrowserTelemetry() call). Optional — @fuzefront/telemetry/browser
  // defaults to the same-origin '/v1/traces' path when unset, assuming the
  // host's ingress proxies it through to FuzeInfra's OTel Collector.
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string
  // App release/version stamped on every RUM payload (see main.tsx's
  // initBrowserRum() call). Optional — falls back to the Vite MODE.
  readonly VITE_APP_RELEASE?: string
  // Fraction (0..1) of sessions that report RUM vitals/timing. Errors are
  // never session-sampled. Optional — defaults to 1.
  readonly VITE_RUM_SAMPLE_RATE?: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
