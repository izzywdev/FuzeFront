-- Migration 002: one-time payment-mode Checkout mirror
-- Idempotent: safe to re-run (all CREATE statements use IF NOT EXISTS).
--
-- LEAST-PRIVILEGE: executed at billing-service startup by the runtime role
-- `billing_svc` (see 001_billing_schema.sql header) — schema-level DDL only,
-- no CREATE EXTENSION / CREATE SCHEMA. gen_random_uuid() is core in
-- PostgreSQL 13+ (FuzeInfra runs postgres:15).

-- billing.payments
-- Local mirror of ONE-TIME payment-mode Stripe Checkout Sessions created via
-- POST /payments/checkout for consumer products (e.g. mendys-datasets).
-- Consumer entities are referenced by (entity_type, entity_id) ONLY — no
-- cross-service FK. A row is inserted as 'pending' at session creation and
-- driven to 'paid' / 'failed' / 'expired' by the Stripe webhooks; it is the
-- reconciliation surface behind GET /payments/sessions/{sessionId}.
CREATE TABLE IF NOT EXISTS billing.payments (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id        TEXT        NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  product_key              TEXT        NOT NULL,
  external_order_id        TEXT        NOT NULL,
  entity_type              TEXT        NOT NULL CHECK (entity_type IN ('user', 'organization')),
  entity_id                UUID        NOT NULL,
  amount_total_cents       INTEGER     NOT NULL CHECK (amount_total_cents >= 0),
  currency                 TEXT        NOT NULL,
  status                   TEXT        NOT NULL CHECK (status IN ('paid', 'failed', 'expired', 'pending')),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- Consumer products correlate on their own order id.
CREATE INDEX IF NOT EXISTS idx_billing_payments_product_order
  ON billing.payments (product_key, external_order_id);
-- stripe_session_id lookups are served by the UNIQUE constraint's index.
