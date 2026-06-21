import { Pool } from 'pg';
import {
  createKafkaClient,
  TypedProducer,
  TypedConsumer,
} from '@fuzefront/shared';
import { loadConfig } from './config';
import { createApp, AppDeps } from './app';
import { createPool, runMigrations } from './db';
import { getStripe } from './stripe-client';
import { PgCustomerRepository } from './repositories/customer.repository';
import { PgPlanRepository } from './repositories/plan.repository';
import { PgSubscriptionRepository } from './repositories/subscription.repository';
import { PgEventRepository } from './repositories/event.repository';
import { PgUsageRepository } from './repositories/usage.repository';
import { CustomerService } from './services/customer.service';
import { PlanService } from './services/plan.service';
import { SubscriptionService } from './services/subscription.service';
import { PermitSyncService, PermitClientLike } from './services/permit.service';
import { MeteringService } from './services/metering.service';
import { KafkaBillingEmitter } from './kafka/producer';
import { startUsageConsumer } from './kafka/consumer';
import { HandlerContext } from './handlers/types';

const FLUSH_INTERVAL_SEC = parseInt(process.env.BILLING_METER_FLUSH_INTERVAL_SEC || '60', 10);

async function main() {
  const config = loadConfig();

  // --- DB ---
  let pool: Pool | undefined;
  if (config.databaseUrl) {
    pool = createPool(config.databaseUrl);
    try {
      await runMigrations(pool);
      console.log('[billing-service] DB migrations complete');
    } catch (err) {
      console.error('[billing-service] DB migration failed (continuing):', err);
    }
  }

  // Without DB or Stripe we can only serve /health (degraded mode).
  if (!pool || !config.stripeSecretKey) {
    console.warn('[billing-service] DATABASE_URL or STRIPE_SECRET_KEY missing — serving /health only');
    const app = createApp();
    startHttp(app, config.port);
    return;
  }

  const stripe = getStripe(config.stripeSecretKey);

  // --- Repositories ---
  const customerRepo = new PgCustomerRepository(pool);
  const planRepo = new PgPlanRepository(pool);
  const subscriptionRepo = new PgSubscriptionRepository(pool);
  const eventRepo = new PgEventRepository(pool);
  const usageRepo = new PgUsageRepository(pool);

  // --- Services ---
  const customers = new CustomerService(stripe, customerRepo);
  const plans = new PlanService(stripe, planRepo);
  const subscriptionService = new SubscriptionService(stripe, customers, plans, subscriptionRepo);
  const metering = new MeteringService(stripe, usageRepo);

  const permitClient = await loadPermitClient(config);
  const permit = new PermitSyncService(permitClient);

  // --- Kafka ---
  const kafka = createKafkaClient({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });
  const producer = new TypedProducer(kafka);
  await producer.connect();
  const emitter = new KafkaBillingEmitter(producer);

  const consumer = new TypedConsumer(kafka, config.kafka.groupId);
  // The usage consumer runs in the background; failures dead-letter via producer.
  startUsageConsumer(consumer, metering, producer).catch((err) =>
    console.error('[billing-service] usage consumer failed to start:', err),
  );

  // --- Metering flush loop ---
  const flushTimer = setInterval(() => {
    metering.flush().catch((err) => console.error('[billing-service] meter flush error:', err));
  }, FLUSH_INTERVAL_SEC * 1000);
  flushTimer.unref?.();

  // --- Handler context ---
  const writePlanCache: HandlerContext['writePlanCache'] = async (args) => {
    const table = args.entityType === 'user' ? 'users' : 'organizations';
    await pool!.query(
      `UPDATE public.${table}
          SET billing_plan_tier = $2, billing_plan_status = $3, trial_ends_at = $4
        WHERE id = $1`,
      [args.entityId, args.planTier, args.status, args.trialEnd],
    );
  };

  const ctx: HandlerContext = {
    customers: customerRepo,
    subscriptions: subscriptionRepo,
    plans: planRepo,
    permit,
    emitter,
    writePlanCache,
  };

  // --- HTTP ---
  const deps: AppDeps = {
    stripe,
    internalToken: config.internalToken,
    plans,
    subscriptionService,
    subscriptionRepo,
    customers,
    webhook: {
      stripe,
      webhookSecret: config.stripeWebhookSecret || '',
      events: eventRepo,
      ctx,
    },
  };
  const app = createApp(deps);
  const server = startHttp(app, config.port);

  // Sync the plan catalogue at startup (best-effort).
  plans.syncPlans().catch((err) => console.error('[billing-service] plan sync failed:', err));

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[billing-service] Shutting down...');
    clearInterval(flushTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await consumer.disconnect();
      await producer.disconnect();
      await pool!.end();
    } catch (err) {
      console.error('[billing-service] shutdown teardown error:', err);
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function startHttp(app: ReturnType<typeof createApp>, port: number) {
  return app.listen(port, () => {
    console.log(`[billing-service] Listening on port ${port}`);
  });
}

/** Lazily load the permitio SDK so unit tests / degraded mode don't require it. */
async function loadPermitClient(config: ReturnType<typeof loadConfig>): Promise<PermitClientLike> {
  const apiKey = process.env.PERMIT_API_KEY;
  const pdp = process.env.PERMIT_PDP_URL || 'http://localhost:7766';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Permit } = require('permitio');
    return new Permit({ token: apiKey, pdp, throwOnError: false }) as PermitClientLike;
  } catch (err) {
    console.warn('[billing-service] permitio unavailable — plan sync will be a no-op');
    const noop = async () => undefined;
    return { api: { users: { update: noop }, tenants: { update: noop } } };
  }
}
