#!/usr/bin/env node
/**
 * Bootstrap the FuzeFront plan catalog in Stripe — idempotent.
 *
 * Stripe is the source of truth for plans: billing-service syncs the catalog FROM
 * Stripe (PlanService.syncPlans → stripe.prices.list). This script makes that
 * catalog reproducible from the repo by creating/updating the canonical Products
 * and recurring monthly Prices.
 *
 * Idempotency:
 *   - Products are matched by a stable metadata key  product.metadata.fuzefront_plan_id
 *   - Prices are matched by Stripe `lookup_key` (e.g. fuzefront_builder_monthly).
 *     Prices are IMMUTABLE in Stripe, so when an amount/currency/interval changes
 *     we create a NEW price, transfer the lookup_key to it, and deactivate the old
 *     one. Re-running with no changes is a no-op.
 *
 * The metadata written here is exactly what billing-service reads:
 *   product.metadata.tier_name   -> Plan.tierName
 *   product.metadata.sort_order  -> Plan.sortOrder
 *   product.metadata.features    -> Plan.features  (JSON array string)
 *   price.unit_amount/currency/recurring.interval -> Plan.unitAmount/currency/billingInterval
 *
 * Usage (key is read from env ONLY — never hardcode or pass on the CLI):
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-plans.mjs            # dry-run
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-plans.mjs --apply    # write to TEST
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe-plans.mjs --apply --live   # write to LIVE
 *
 * Safe by default: dry-run unless --apply; refuses a live (sk_live_) account
 * unless --live is also passed.
 */
import Stripe from 'stripe';

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY env var is required (do not pass keys on the CLI).');
  process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const LIVE_OK = process.argv.includes('--live');
const IS_LIVE = KEY.startsWith('sk_live');
if (IS_LIVE && !LIVE_OK) {
  console.error('REFUSING to touch a LIVE Stripe account (key is sk_live_…) without --live.');
  process.exit(1);
}

const stripe = new Stripe(KEY);
const CURRENCY = 'usd';
const INTERVAL = 'month';
const lookupKey = (id) => `fuzefront_${id}_monthly`;

/**
 * Canonical catalog. `amount` is in cents. `tier_name` (== id) is what the UI and
 * billing-service key off. Enterprise is "contact sales" (not self-serve); the UI
 * renders a Contact-Sales CTA for tier_name === 'enterprise'. The $1 `test` plan
 * is for end-to-end checkout testing and is flagged test_only so the UI can hide
 * it outside test environments.
 */
const PLANS = [
  { id: 'free',       name: 'FuzeFront Free',       amount: 0,    sort: 0,
    features: ['1 application', 'Community support', 'Core platform'] },
  { id: 'test',       name: 'FuzeFront Test ($1)',  amount: 100,  sort: 1, testOnly: true,
    features: ['End-to-end billing test plan — not for production sale'] },
  { id: 'builder',    name: 'FuzeFront Builder',    amount: 2900, sort: 2,
    features: ['Unlimited applications', 'AI chat assistant', 'Email support'] },
  { id: 'business',   name: 'FuzeFront Business',   amount: 9900, sort: 3,
    features: ['Everything in Builder', 'SSO / OIDC', 'Priority support', 'Advanced analytics'] },
  { id: 'enterprise', name: 'FuzeFront Enterprise', amount: 0,    sort: 4, contactSales: true,
    features: ['Everything in Business', 'Custom limits & SLA', 'Dedicated support', 'Custom contracts'] },
];

async function findProduct(id) {
  const res = await stripe.products.search({ query: `metadata['fuzefront_plan_id']:'${id}'`, limit: 1 });
  return res.data[0] ?? null;
}
async function findActivePriceByLookup(key) {
  const res = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  return res.data[0] ?? null;
}

async function ensurePlan(p) {
  const metadata = {
    fuzefront_plan_id: p.id,
    tier_name: p.id,
    sort_order: String(p.sort),
    features: JSON.stringify(p.features),
    ...(p.contactSales ? { contact_sales: 'true' } : {}),
    ...(p.testOnly ? { test_only: 'true' } : {}),
  };

  let product = await findProduct(p.id);
  let productAction = 'reuse';
  if (!product) {
    productAction = 'create';
    if (APPLY) product = await stripe.products.create({ name: p.name, metadata });
  } else if (APPLY) {
    productAction = 'update';
    await stripe.products.update(product.id, { name: p.name, metadata });
  }

  const key = lookupKey(p.id);
  const existing = await findActivePriceByLookup(key);
  const changed =
    !existing ||
    existing.unit_amount !== p.amount ||
    existing.currency !== CURRENCY ||
    existing.recurring?.interval !== INTERVAL;
  let priceAction = 'reuse';
  if (changed) {
    priceAction = existing ? 'replace' : 'create';
    if (APPLY) {
      await stripe.prices.create({
        product: product.id,
        currency: CURRENCY,
        unit_amount: p.amount,
        recurring: { interval: INTERVAL },
        lookup_key: key,
        transfer_lookup_key: Boolean(existing),
        metadata: { tier_name: p.id },
      });
      if (existing) await stripe.prices.update(existing.id, { active: false });
    }
  }

  const price = `$${(p.amount / 100).toFixed(2)}/mo`.padEnd(10);
  console.log(`  ${p.id.padEnd(11)} ${price} product:${productAction.padEnd(6)} price:${priceAction.padEnd(7)} lookup_key:${key}`);
}

(async () => {
  console.log(
    `\nFuzeFront → Stripe plan setup  [${IS_LIVE ? 'LIVE' : 'TEST'} account]  ` +
      `${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes — pass --apply to write)'}\n`,
  );
  for (const p of PLANS) await ensurePlan(p);
  console.log(
    `\n${APPLY ? 'Applied' : 'Would apply'} ${PLANS.length} plans. ` +
      `billing-service picks these up via PlanService.syncPlans() (Stripe = source of truth).\n` +
      `Next: register the webhook endpoint and POST /api/v1/billing (internal) once deployed.\n`,
  );
})().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
