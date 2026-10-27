-- Migration 005: canonicalize plan tier names
-- Aligns billing.subscriptions.plan_tier and billing.plans.tier_name with the
-- canonical set: free | starter | growth | enterprise.
--
-- Legacy values introduced by setup-stripe-plans.mjs (builder → starter,
-- business → growth, professional → growth, scale → growth, test → free)
-- are renamed in-place. The old plan_tier TEXT column had no CHECK constraint;
-- this migration adds one covering both canonical and transitional legacy values
-- so any new row is validated.
--
-- Idempotent: safe to re-run.

-- 1. Normalize legacy tier values in billing.subscriptions.
UPDATE billing.subscriptions
SET plan_tier = CASE plan_tier
  WHEN 'professional' THEN 'growth'
  WHEN 'scale'        THEN 'growth'
  WHEN 'business'     THEN 'growth'
  WHEN 'builder'      THEN 'starter'
  WHEN 'test'         THEN 'free'
  WHEN 'basic'        THEN 'starter'
  ELSE plan_tier
END
WHERE plan_tier IN ('professional', 'scale', 'business', 'builder', 'test', 'basic');

-- 2. Normalize legacy tier values in billing.plans (the Stripe read-cache).
UPDATE billing.plans
SET tier_name = CASE tier_name
  WHEN 'professional' THEN 'growth'
  WHEN 'scale'        THEN 'growth'
  WHEN 'business'     THEN 'growth'
  WHEN 'builder'      THEN 'starter'
  WHEN 'test'         THEN 'free'
  WHEN 'basic'        THEN 'starter'
  ELSE tier_name
END
WHERE tier_name IN ('professional', 'scale', 'business', 'builder', 'test', 'basic');

-- 3. Add a CHECK constraint on billing.subscriptions.plan_tier.
--    DROP first to make this re-runnable if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_plan_tier_canonical'
      AND conrelid = 'billing.subscriptions'::regclass
  ) THEN
    ALTER TABLE billing.subscriptions
      ADD CONSTRAINT subscriptions_plan_tier_canonical
      CHECK (plan_tier IN ('free', 'starter', 'growth', 'enterprise', 'unknown'));
  END IF;
END $$;

-- 4. Add a CHECK constraint on billing.plans.tier_name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plans_tier_name_canonical'
      AND conrelid = 'billing.plans'::regclass
  ) THEN
    ALTER TABLE billing.plans
      ADD CONSTRAINT plans_tier_name_canonical
      CHECK (tier_name IN ('free', 'starter', 'growth', 'enterprise', 'unknown'));
  END IF;
END $$;
