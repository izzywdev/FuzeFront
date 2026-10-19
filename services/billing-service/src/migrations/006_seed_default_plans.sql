-- Migration 006: seed canonical default plans
-- Inserts the four canonical plan tiers (free | starter | growth | enterprise)
-- into billing.plans with placeholder Stripe IDs so the table is never empty
-- after a cold-boot migration run.
--
-- Placeholder price IDs are deliberately aligned with the PLAN_ID_TO_PRICE_ID
-- map in plan.service.ts so that resolvePriceId() can locate seeded plans by
-- price-id until a real Stripe catalogue sync replaces them.
--
-- A real Stripe catalogue sync (PlanService.syncPlans) will UPDATE these rows
-- via the ON CONFLICT (stripe_price_id) DO UPDATE path in the plan repository
-- upsert, replacing the placeholder IDs with the live Stripe values.
--
-- Idempotent: the INSERT ... ON CONFLICT DO NOTHING makes this safe to re-run
-- and safe to run after a Stripe sync has already populated real rows
-- (the UNIQUE index on stripe_price_id prevents double-insertion, and the
-- ON CONFLICT DO NOTHING means a real row is never overwritten by a placeholder).

INSERT INTO billing.plans (
  stripe_price_id,
  stripe_product_id,
  tier_name,
  display_name,
  billing_interval,
  unit_amount,
  currency,
  seat_based,
  metered_meter_name,
  features,
  is_active,
  sort_order
) VALUES
  -- Free tier: $0/month, no self-serve Stripe price (served without a checkout)
  (
    'price_free_monthly_placeholder',
    'prod_placeholder_free',
    'free',
    'Free',
    'month',
    0,
    'usd',
    FALSE,
    NULL,
    '["Core features","1 workspace","Up to 3 users","Community support"]',
    TRUE,
    0
  ),
  -- Starter: $29/month; price ID matches PLAN_ID_TO_PRICE_ID['starter'] placeholder
  (
    'price_starter_monthly_placeholder',
    'prod_placeholder_starter',
    'starter',
    'Starter',
    'month',
    2900,
    'usd',
    FALSE,
    NULL,
    '["Core features","Up to 5 users","1 workspace","Email support"]',
    TRUE,
    1
  ),
  -- Growth: $99/month; price ID matches PLAN_ID_TO_PRICE_ID['growth'] placeholder
  (
    'price_growth_monthly_placeholder',
    'prod_placeholder_growth',
    'growth',
    'Growth',
    'month',
    9900,
    'usd',
    FALSE,
    NULL,
    '["Everything in Starter","Unlimited applications","SSO / OIDC","API keys","Module Federation hosting","Priority support"]',
    TRUE,
    2
  ),
  -- Enterprise: contact-sales; unit_amount = -1 signals no self-serve Stripe price.
  -- price ID 'contact_sales' matches PLAN_ID_TO_PRICE_ID['enterprise'] so that
  -- resolvePriceId can identify this row when validating an enterprise checkout path.
  (
    'contact_sales',
    'prod_placeholder_enterprise',
    'enterprise',
    'Enterprise',
    'month',
    -1,
    'usd',
    TRUE,
    NULL,
    '["Everything in Growth","Custom SLAs","Custom domain","Compliance exports","Dedicated CSM","Custom contracts"]',
    TRUE,
    3
  )
ON CONFLICT (stripe_price_id) DO NOTHING;
