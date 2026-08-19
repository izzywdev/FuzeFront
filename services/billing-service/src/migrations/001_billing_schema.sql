-- Migration 001: billing schema
-- Idempotent: safe to re-run (all CREATE statements use IF NOT EXISTS).
--
-- LEAST-PRIVILEGE: this migration is executed at billing-service startup by the
-- runtime role `billing_svc`, which is NOSUPERUSER and is NOT the platform
-- database owner — it only OWNS the `billing` schema (granted by the pre-install
-- billing-db-bootstrap Job via CREATE SCHEMA billing AUTHORIZATION billing_svc).
-- So this file MUST NOT contain database-level DDL billing_svc cannot run:
--   * CREATE EXTENSION -> "permission denied to create extension" (needs CREATE
--                         on the DB / superuser). The bootstrap Job creates
--                         pgcrypto as the superuser instead.
--   * CREATE SCHEMA    -> "permission denied for database" (needs CREATE on the
--                         DB). The bootstrap Job creates the `billing` schema.
-- Both were empirically reproduced against postgres:15 as billing_svc and moved
-- into the bootstrap. gen_random_uuid() is CORE in PostgreSQL 13+ (FuzeInfra runs
-- postgres:15), so the UUID defaults below need no pgcrypto dependency.

-- billing.customers
-- Links platform entities (users / organizations) to Stripe customers.
CREATE TABLE IF NOT EXISTS billing.customers (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type        TEXT        NOT NULL CHECK (entity_type IN ('user', 'organization')),
  entity_id          UUID        NOT NULL,
  stripe_customer_id TEXT        NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

-- billing.subscriptions
-- Stripe subscription state mirrored locally.
CREATE TABLE IF NOT EXISTS billing.subscriptions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id            UUID        NOT NULL REFERENCES billing.customers(id),
  stripe_subscription_id TEXT        NOT NULL UNIQUE,
  stripe_price_id        TEXT        NOT NULL,
  plan_tier              TEXT        NOT NULL,
  status                 TEXT        NOT NULL,
  seat_quantity          INTEGER     NOT NULL DEFAULT 1,
  trial_start            TIMESTAMPTZ,
  trial_end              TIMESTAMPTZ,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN     DEFAULT FALSE,
  canceled_at            TIMESTAMPTZ,
  metadata               JSONB       DEFAULT '{}',
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- billing.stripe_events
-- Idempotency/dedup table for processed Stripe webhook events.
CREATE TABLE IF NOT EXISTS billing.stripe_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT        NOT NULL UNIQUE,
  event_type      TEXT        NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT now(),
  payload         JSONB       NOT NULL
);

-- billing.usage_events
-- Metering buffer for usage-based billing events before reporting to Stripe.
CREATE TABLE IF NOT EXISTS billing.usage_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             UUID        NOT NULL,
  meter_event_name      TEXT        NOT NULL,
  quantity              BIGINT      NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL,
  correlation_id        TEXT        NOT NULL UNIQUE,
  reported_at           TIMESTAMPTZ,
  stripe_meter_event_id TEXT
);

-- billing.plans
-- Read-cache for Stripe product/price catalogue; source of truth is Stripe.
CREATE TABLE IF NOT EXISTS billing.plans (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_price_id     TEXT        NOT NULL UNIQUE,
  stripe_product_id   TEXT        NOT NULL,
  tier_name           TEXT        NOT NULL,
  display_name        TEXT        NOT NULL,
  billing_interval    TEXT        NOT NULL,
  unit_amount         INTEGER     NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'usd',
  seat_based          BOOLEAN     DEFAULT FALSE,
  metered_meter_name  TEXT,
  features            JSONB       DEFAULT '[]',
  is_active           BOOLEAN     DEFAULT TRUE,
  sort_order          INTEGER     DEFAULT 0,
  synced_at           TIMESTAMPTZ DEFAULT now()
);
