-- Migration 003: vendor-neutral, DB-backed invoice store
-- Idempotent: safe to re-run (all CREATE statements use IF NOT EXISTS).
--
-- LEAST-PRIVILEGE: executed at billing-service startup by the runtime role
-- `billing_svc` (see 001_billing_schema.sql header) — schema-level DDL only,
-- no CREATE EXTENSION / CREATE SCHEMA. gen_random_uuid() is core in
-- PostgreSQL 13+ (FuzeInfra runs postgres:15).
--
-- billing.invoices
-- Local, provider-neutral mirror of invoices synced from the payment provider
-- (via POST /invoices/sync and the invoice.* webhooks). Exposed through
-- GET /invoices with OUR uuid `id` as the stable identifier; the provider's own
-- invoice id is confined to (provider, provider_invoice_id) and never leaked.
CREATE TABLE IF NOT EXISTS billing.invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES billing.customers(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'stripe',
  provider_invoice_id TEXT NOT NULL,
  number              TEXT,
  status              TEXT NOT NULL,
  amount_due_cents    INTEGER NOT NULL CHECK (amount_due_cents >= 0),
  amount_paid_cents   INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
  currency            TEXT NOT NULL,
  hosted_invoice_url  TEXT,
  invoice_pdf_url     TEXT,
  issued_at           TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_customer_issued
  ON billing.invoices (customer_id, issued_at DESC, id DESC);
