import { loadConfig } from './config';
import { createApp, AppDeps } from './app';
import { StripePaymentProvider } from './providers/stripe/stripe-payment-provider';
import { PaymentProvider } from './providers/payment-provider';

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
  if (!config.stripeSecretKey) {
    console.warn(
      '[payment-service] STRIPE_SECRET_KEY missing — serving /health only (gateway scaffold, degraded mode)',
    );
    const app = createApp();
    startHttp(app, config.port);
    return;
  }

  const provider = selectProvider(config);
  const deps: AppDeps = { provider, internalToken: config.internalToken };
  const app = createApp(deps);
  startHttp(app, config.port);
}

function startHttp(app: ReturnType<typeof createApp>, port: number) {
  return app.listen(port, () => {
    console.log(`[payment-service] Listening on port ${port}`);
  });
}

// Entrypoint. Without invoking main(), `node dist/index.js` would define it and
// exit 0 with no server (CrashLoopBackOff "Completed"). Invoke + fail loud.
main();
