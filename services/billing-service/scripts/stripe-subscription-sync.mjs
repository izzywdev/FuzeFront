#!/usr/bin/env node
/**
 * One-time Stripe → FuzeFront billing DB sync.
 *
 * Imports existing Stripe subscriptions and invoices for every customer that
 * already has a billing.customers row (matched by stripe_customer_id). For
 * customers whose Stripe metadata carries `entity_type` + `entity_id` but no
 * local row yet, the row is created first.
 *
 * Idempotency: all upserts use ON CONFLICT on the Stripe id, so re-running is
 * safe.  Active/trialing subscriptions emit a billing.subscription.changed
 * Kafka event so the backend's billingProjection consumer updates the
 * organizations/users plan-tier cache.
 *
 * Usage (keys read from env ONLY — never pass secrets on the CLI):
 *   STRIPE_SECRET_KEY=sk_test_... DATABASE_URL=postgresql://...
 *     node scripts/stripe-subscription-sync.mjs
 *       (dry-run — reads, logs, no writes)
 *
 *   ... node scripts/stripe-subscription-sync.mjs --apply
 *       (writes to TEST Stripe / target DB)
 *
 *   ... node scripts/stripe-subscription-sync.mjs --apply --live
 *       (required when key is sk_live_…)
 *
 *   KAFKA_BROKERS=fuzeinfra-kafka:9092 ... --apply  (also emits Kafka events)
 *
 * Safe by default: dry-run unless --apply; refuses a live key without --live.
 */

import Stripe from 'stripe';
import pg from 'pg';
import { Kafka } from 'kafkajs';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Config / safety gates
// ---------------------------------------------------------------------------

const STRIPE_KEY    = process.env.STRIPE_SECRET_KEY;
const DATABASE_URL  = process.env.DATABASE_URL;
const KAFKA_BROKERS = process.env.KAFKA_BROKERS; // optional

if (!STRIPE_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY env var is required (do not pass keys on the CLI).');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var is required.');
  process.exit(1);
}

const APPLY   = process.argv.includes('--apply');
const LIVE_OK = process.argv.includes('--live');
const IS_LIVE = STRIPE_KEY.startsWith('sk_live');
if (IS_LIVE && !LIVE_OK) {
  console.error('REFUSING to touch a LIVE Stripe account (key is sk_live_…) without --live.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const stripe = new Stripe(STRIPE_KEY);
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

let kafkaProducer = null;
if (KAFKA_BROKERS && APPLY) {
  const kafka = new Kafka({
    clientId: 'stripe-subscription-sync',
    brokers: KAFKA_BROKERS.split(',').map(b => b.trim()),
  });
  kafkaProducer = kafka.producer();
  await kafkaProducer.connect();
}

// ---------------------------------------------------------------------------
// Plan-tier resolution
// ---------------------------------------------------------------------------

/** Build a map: stripe_price_id → tier_name, from billing.plans + known static prices. */
async function buildPriceTierMap() {
  const res = await pool.query(
    'SELECT stripe_price_id, tier_name FROM billing.plans WHERE stripe_price_id IS NOT NULL'
  );
  const map = {};
  for (const row of res.rows) {
    map[row.stripe_price_id] = row.tier_name;
  }
  // Known live/legacy prices not guaranteed to be in billing.plans yet
  map['price_1TnCqVDaNn3aKLEz05TbFbFQ'] = 'basic';
  return map;
}

function resolveTier(priceId, priceTierMap) {
  return priceTierMap[priceId] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Mapping helpers (mirrors TypeScript subscription.mapper.ts + stripe-payment-provider.ts)
// ---------------------------------------------------------------------------

const unixToIso = (s) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);

function mapStripeSubscription(sub, { customerId, planTier }) {
  const item = sub.items?.data?.[0];
  const priceId      = item?.price?.id ?? '';
  const seatQuantity = item?.quantity  ?? 1;
  return {
    customerId,
    subscriptionId: sub.id,
    priceId,
    planTier,
    status: sub.status,
    seatQuantity,
    trialStart:          unixToIso(sub.trial_start),
    trialEnd:            unixToIso(sub.trial_end),
    currentPeriodStart:  unixToIso(sub.current_period_start),
    currentPeriodEnd:    unixToIso(sub.current_period_end),
    cancelAtPeriodEnd:   Boolean(sub.cancel_at_period_end),
    canceledAt:          unixToIso(sub.canceled_at),
  };
}

function mapStripeInvoice(inv) {
  return {
    providerInvoiceId: inv.id,
    number:            inv.number ?? null,
    status:            inv.status ?? 'draft',
    amountDueCents:    inv.amount_due,
    amountPaidCents:   inv.amount_paid,
    currency:          (inv.currency || '').toLowerCase(),
    hostedInvoiceUrl:  inv.hosted_invoice_url ?? null,
    invoicePdfUrl:     inv.invoice_pdf ?? null,
    issuedAt:          new Date(inv.created * 1000),
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function findCustomerByStripeId(stripeCustomerId) {
  const res = await pool.query(
    `SELECT id, entity_type, entity_id, stripe_customer_id
       FROM billing.customers
      WHERE stripe_customer_id = $1`,
    [stripeCustomerId]
  );
  return res.rows[0] ?? null;
}

async function createCustomer(entityType, entityId, stripeCustomerId) {
  const res = await pool.query(
    `INSERT INTO billing.customers (entity_type, entity_id, stripe_customer_id)
          VALUES ($1, $2, $3)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now()
     RETURNING id, entity_type, entity_id, stripe_customer_id`,
    [entityType, entityId, stripeCustomerId]
  );
  return res.rows[0];
}

async function upsertSubscription(row) {
  await pool.query(
    `INSERT INTO billing.subscriptions
          (customer_id, stripe_subscription_id, stripe_price_id, plan_tier, status,
           seat_quantity, trial_start, trial_end, current_period_start, current_period_end,
           cancel_at_period_end, canceled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
          customer_id          = EXCLUDED.customer_id,
          stripe_price_id      = EXCLUDED.stripe_price_id,
          plan_tier            = EXCLUDED.plan_tier,
          status               = EXCLUDED.status,
          seat_quantity        = EXCLUDED.seat_quantity,
          trial_start          = EXCLUDED.trial_start,
          trial_end            = EXCLUDED.trial_end,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end   = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          canceled_at          = EXCLUDED.canceled_at,
          updated_at           = now()`,
    [
      row.customerId, row.subscriptionId, row.priceId, row.planTier, row.status,
      row.seatQuantity, row.trialStart, row.trialEnd,
      row.currentPeriodStart, row.currentPeriodEnd,
      row.cancelAtPeriodEnd, row.canceledAt,
    ]
  );
}

async function upsertInvoice(customerId, inv) {
  await pool.query(
    `INSERT INTO billing.invoices
          (customer_id, provider, provider_invoice_id, number, status,
           amount_due_cents, amount_paid_cents, currency,
           hosted_invoice_url, invoice_pdf_url, issued_at)
     VALUES ($1,'stripe',$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (provider, provider_invoice_id) DO UPDATE SET
          customer_id        = EXCLUDED.customer_id,
          number             = EXCLUDED.number,
          status             = EXCLUDED.status,
          amount_due_cents   = EXCLUDED.amount_due_cents,
          amount_paid_cents  = EXCLUDED.amount_paid_cents,
          currency           = EXCLUDED.currency,
          hosted_invoice_url = EXCLUDED.hosted_invoice_url,
          invoice_pdf_url    = EXCLUDED.invoice_pdf_url,
          issued_at          = EXCLUDED.issued_at,
          updated_at         = now()`,
    [
      customerId,
      inv.providerInvoiceId, inv.number, inv.status,
      inv.amountDueCents, inv.amountPaidCents, inv.currency,
      inv.hostedInvoiceUrl, inv.invoicePdfUrl, inv.issuedAt,
    ]
  );
}

async function emitSubscriptionChanged(customer, sub, planTier) {
  if (!kafkaProducer) return;
  const payload = {
    entityId:             customer.entity_id,
    entityType:           customer.entity_type,
    planTier,
    status:               sub.status,
    seatQuantity:         sub.items?.data?.[0]?.quantity ?? 1,
    stripeSubscriptionId: sub.id,
  };
  await kafkaProducer.send({
    topic: 'billing.subscription.changed',
    messages: [{
      key: customer.entity_id,
      value: JSON.stringify({
        version:       '1.0',
        topic:         'billing.subscription.changed',
        correlationId: randomUUID(),
        occurredAt:    new Date().toISOString(),
        payload,
      }),
    }],
  });
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

async function syncCustomer(stripeCustomer, priceTierMap, stats) {
  const stripeId = stripeCustomer.id;
  let customer = await findCustomerByStripeId(stripeId);

  if (!customer) {
    // Attempt to create from Stripe metadata
    const meta = stripeCustomer.metadata ?? {};
    if (meta.entity_type && meta.entity_id) {
      stats.customersCreated++;
      console.log(`  → no local row; creating from metadata (${meta.entity_type}:${meta.entity_id})`);
      if (APPLY) {
        customer = await createCustomer(meta.entity_type, meta.entity_id, stripeId);
      } else {
        console.log(`    [dry-run] would create billing.customers row`);
        // Use a placeholder row for dry-run reporting
        customer = { id: '<dry-run>', entity_type: meta.entity_type, entity_id: meta.entity_id, stripe_customer_id: stripeId };
      }
    } else {
      stats.customersSkipped++;
      console.log(`  → no local row and no entity_type/entity_id in metadata — skipping`);
      return;
    }
  }

  // Subscriptions
  let subPage = await stripe.subscriptions.list({
    customer: stripeId,
    status: 'all',
    limit: 100,
    expand: ['data.items'],
  });
  let subCount = 0;
  let activeCount = 0;
  while (true) {
    for (const sub of subPage.data) {
      const priceId  = sub.items?.data?.[0]?.price?.id ?? '';
      const planTier = resolveTier(priceId, priceTierMap);
      const mapped   = mapStripeSubscription(sub, { customerId: customer.id, planTier });

      if (APPLY) {
        await upsertSubscription(mapped);
        const isActive = sub.status === 'active' || sub.status === 'trialing';
        if (isActive) {
          await emitSubscriptionChanged(customer, sub, planTier);
          activeCount++;
        }
      } else {
        console.log(`    [dry-run] sub ${sub.id} (${sub.status}) → tier:${planTier}`);
      }
      subCount++;
    }
    if (!subPage.has_more) break;
    subPage = await stripe.subscriptions.list({
      customer: stripeId, status: 'all', limit: 100, expand: ['data.items'],
      starting_after: subPage.data[subPage.data.length - 1].id,
    });
  }
  stats.subscriptionsUpserted += subCount;

  // Invoices
  let invPage = await stripe.invoices.list({ customer: stripeId, limit: 100 });
  let invCount = 0;
  while (true) {
    for (const inv of invPage.data) {
      const mapped = mapStripeInvoice(inv);
      if (APPLY) {
        await upsertInvoice(customer.id, mapped);
      } else {
        console.log(`    [dry-run] invoice ${inv.id} (${inv.status}) $${((inv.amount_due ?? 0) / 100).toFixed(2)}`);
      }
      invCount++;
    }
    if (!invPage.has_more) break;
    invPage = await stripe.invoices.list({
      customer: stripeId, limit: 100,
      starting_after: invPage.data[invPage.data.length - 1].id,
    });
  }
  stats.invoicesUpserted += invCount;

  console.log(
    `  ✓ subs:${subCount} (${activeCount} active/trialing events emitted)  invoices:${invCount}`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log(
    `\nFuzeFront → Stripe billing sync  [${IS_LIVE ? 'LIVE' : 'TEST'}]  ` +
    `${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes — pass --apply to write)'}\n`
  );
  if (APPLY && kafkaProducer) {
    console.log(`Kafka: ${KAFKA_BROKERS}\n`);
  } else if (APPLY) {
    console.log('Kafka: not configured — Kafka events will NOT be emitted (set KAFKA_BROKERS)\n');
  }

  const priceTierMap = await buildPriceTierMap();
  console.log(`Plan tier map: ${Object.keys(priceTierMap).length} prices loaded from billing.plans`);
  Object.entries(priceTierMap).forEach(([p, t]) => console.log(`  ${p} → ${t}`));
  console.log('');

  const stats = {
    customersProcessed: 0,
    customersSkipped:   0,
    customersCreated:   0,
    subscriptionsUpserted: 0,
    invoicesUpserted:   0,
  };

  // Paginate all Stripe customers
  let page = await stripe.customers.list({ limit: 100, expand: ['data'] });
  while (true) {
    for (const customer of page.data) {
      console.log(`Customer: ${customer.id}  ${customer.email ?? '(no email)'}`);
      stats.customersProcessed++;
      try {
        await syncCustomer(customer, priceTierMap, stats);
      } catch (err) {
        console.error(`  ERROR processing ${customer.id}: ${err?.message ?? err}`);
      }
      console.log('');
    }
    if (!page.has_more) break;
    page = await stripe.customers.list({
      limit: 100,
      expand: ['data'],
      starting_after: page.data[page.data.length - 1].id,
    });
  }

  console.log('─'.repeat(60));
  console.log(`Customers processed:   ${stats.customersProcessed}`);
  console.log(`Customers created:     ${stats.customersCreated}`);
  console.log(`Customers skipped:     ${stats.customersSkipped}`);
  console.log(`Subscriptions upserted:${stats.subscriptionsUpserted}`);
  console.log(`Invoices upserted:     ${stats.invoicesUpserted}`);
  console.log('');
  if (!APPLY) {
    console.log('Dry-run complete — no changes written. Pass --apply to write.\n');
  } else {
    console.log('Sync complete.\n');
  }
})()
  .catch((err) => {
    console.error('FAILED:', err?.message ?? err);
    process.exit(1);
  })
  .finally(async () => {
    if (kafkaProducer) await kafkaProducer.disconnect();
    await pool.end();
  });
