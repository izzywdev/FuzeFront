# FuzeFront pricing plans

> **Source of truth: Stripe.** billing-service syncs the catalog **from** Stripe
> (`PlanService.syncPlans` → `stripe.prices.list`); the local `billing.plans`
> table is only a denormalised read cache. We deliberately **defer** building our
> own pricing-management backend/UI on top of Stripe — the trade-off is that we
> can't yet let 3rd parties run their own priced apps on FuzeFront (a future
> version). To keep the catalog reproducible from the repo, the canonical plans
> are bootstrapped by an idempotent script (below).

## The plans

| Plan | tier_name | Price (monthly) | Self-serve | Notes |
|------|-----------|-----------------|------------|-------|
| Free | `free` | $0 | ✅ | Entry tier |
| Builder | `builder` | **$29** | ✅ | |
| Business | `business` | **$99** | ✅ | |
| Enterprise | `enterprise` | — | ❌ **Contact sales** | No self-serve checkout; UI shows a Contact-Sales CTA for `tier_name === 'enterprise'` |
| Test | `test` | **$1** | ✅ (test only) | End-to-end checkout testing; `test_only=true` metadata so the UI can hide it outside test envs |

Amounts are `unit_amount` in cents on a `recurring { interval: month }` USD price.
Each Stripe **Product** carries the metadata billing-service reads:
`tier_name`, `sort_order`, `features` (JSON array). Enterprise/Test also carry
`contact_sales` / `test_only` flags for the UI.

## Bootstrapping the catalog in Stripe

`services/billing-service/scripts/setup-stripe-plans.mjs` creates/updates the
Products + Prices **idempotently** (Products matched by
`metadata.fuzefront_plan_id`; Prices by Stripe `lookup_key`, e.g.
`fuzefront_builder_monthly`). Prices are immutable in Stripe, so a price change
creates a new Price and transfers the `lookup_key` to it, deactivating the old.

```bash
cd services/billing-service

# Dry-run against TEST (no writes):
STRIPE_SECRET_KEY=sk_test_... npm run setup:stripe-plans

# Apply to TEST:
STRIPE_SECRET_KEY=sk_test_... npm run setup:stripe-plans -- --apply

# Apply to LIVE (extra guard required):
STRIPE_SECRET_KEY=sk_live_... npm run setup:stripe-plans -- --apply --live
```

**Never** pass the key on the CLI history-visibly or commit it — the script reads
`STRIPE_SECRET_KEY` from the environment only. Run it once per Stripe account
(test and live are separate catalogs). After it runs, billing-service's
`syncPlans()` pulls the catalog into `billing.plans`.

## End-to-end test path

Use the **`test` ($1)** plan to exercise checkout → subscription → webhook →
entitlement without real spend. With Stripe in test mode you can use the test
card `4242 4242 4242 4242`. The webhook endpoint is
`https://app.fuzefront.com/api/v1/billing/webhooks/stripe` and must receive:
`customer.subscription.updated`, `customer.subscription.deleted`,
`customer.subscription.trial_will_end`, `invoice.payment_succeeded`,
`invoice.payment_failed`.

## Secrets (never in git/chat)

billing-service needs three secrets in the prod SealedSecret `fuzefront-secrets`
(and the matching CI/runtime config): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
(from the Stripe webhook endpoint), and `BILLING_INTERNAL_TOKEN` (self-minted
shared secret for service-to-service auth). See the billing deploy runbook.
