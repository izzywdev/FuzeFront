-- Migration 001: config_namespaces (FFRNT-154 / FF-EPIC-17-S2)
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS everywhere).
--
-- No CREATE SCHEMA / CREATE EXTENSION here — see billing-service's
-- 001_billing_schema.sql for why: a least-privilege runtime role cannot run
-- either (permission denied), and gen_random_uuid() is CORE in PostgreSQL
-- 13+ (FuzeInfra runs postgres:15), so no pgcrypto dependency is needed.
--
-- IDENTITY: `id` is a native 16-byte `uuid` column populated by the
-- application from a server-minted TypeID (`cns_…`, mintId('namespace')),
-- converted with toUuid() at the repository boundary — see
-- governance/identifier-standard.md §2 and packages/identity/src/registry.ts.
-- There is deliberately NO `DEFAULT gen_random_uuid()` on this column: a
-- default would let a row be inserted without going through mintId(), which
-- is the only sanctioned id constructor.

CREATE TABLE IF NOT EXISTS config_namespaces (
  id            UUID        PRIMARY KEY,
  namespace     TEXT        NOT NULL UNIQUE,
  display_name  TEXT        NOT NULL,
  description   TEXT,
  owner_app_id  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- namespace is looked up by name on every request that addresses
-- /v1/namespaces/{namespace}/... — the UNIQUE constraint above already
-- creates a covering btree index, so no separate index is added here.
