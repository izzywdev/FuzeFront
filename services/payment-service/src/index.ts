import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { loadConfig } from './config';
import { createApp, AppDeps } from './app';
import { StripePaymentProvider } from './providers/stripe/stripe-payment-provider';
import { PaymentProvider } from './providers/payment-provider';

// Bootstrap OpenTelemetry BEFORE the express app is constructed below (see
// backend/security/src/index.ts for the full rationale). Sends OTLP to
// FuzeInfra's Collector; endpoint/protocol/sampling default from OTEL_* env.
// Handle retained (unlike the discarded call this used to be): without it
// there is nothing for the shutdown hook below to flush, and the SDK's batch
// exporter can lose the tail of in-flight spans on every pod eviction/rollout.
const telemetry: TelemetryHandle = initTelemetry({
  serviceName: 'payment-service',
  serviceVersion: process.env.npm_package_version,
});

/**
 * payment-service entrypoint — the vendor-neutral payment gateway.
 *
 * Runnable with ZERO secrets: without a vendor key the gateway boots and serves
 * `/health` (degraded mode). With a key it also mounts the neutral Payment
 * Provider API under `/api/v1/payments`, backed by the configured vendor adapter
 * (the ONLY thing that touches the vendor SDK). Scaffold: adapter methods throw
 * NotImplemented → HTTP 501 until the live path is absorbed from billing-service.
 */
function selectProvider(config: ReturnType<typeof loadConfig>): PaymentProvider {
  // Single adapter today. A future vendor swap adds a sibling adapter and
  // switches on config.provider here — no call-site changes.
  switch (config.provider) {
    case 'stripe':
    default:
      return new StripePaymentProvider({ secretKey: config.stripeSecretKey });
  }
}

function main() {
  const config = loadConfig();

  // Degraded mode: no vendor key → health only, exactly like billing-service.
  let app: ReturnType<typeof createApp>;
  if (!config.stripeSecretKey) {
    console.warn(
      '[payment-service] STRIPE_SECRET_KEY missing — serving /health only (gateway scaffold, degraded mode)',
    );
    app = createApp();
  } else {
    const provider = selectProvider(config);
    const deps: AppDeps = { provider, securityServiceUrl: config.securityServiceUrl };
    app = createApp(deps);
  }

  const server = startHttp(app, config.port);

  // Stop accepting new connections before shutting down telemetry, so the
  // batch exporter isn't torn down while requests are still in flight — same
  // ordering as billing-service/chat-service's shutdown hooks.
  const shutdown = () => {
    console.log('[payment-service] Shutting down...');
    server.close(() => {
      telemetry.shutdown().catch(() => {}).finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function startHttp(app: ReturnType<typeof createApp>, port: number) {
  return app.listen(port, () => {
    console.log(`[payment-service] Listening on port ${port}`);
  });
}

// Entrypoint. Without invoking main(), `node dist/index.js` would define it and
// exit 0 with no server (CrashLoopBackOff "Completed"). Invoke + fail loud.
main();
