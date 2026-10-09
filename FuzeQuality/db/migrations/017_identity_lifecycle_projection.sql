-- FQ identity projection. FuzeFront Identity is authoritative; this schema is
-- an idempotent local projection used only to scope FuzeQuality data safely.
CREATE TABLE IF NOT EXISTS fuzequality.tenants (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  tenant_type text NOT NULL CHECK (tenant_type IN ('platform','organization','personal')),
  owner_id text,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.principals (
  id text PRIMARY KEY,
  email text NOT NULL,
  first_name text,
  last_name text,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.organization_memberships (
  -- Kafka partitions do not guarantee cross-topic ordering. Keep these as
  -- references rather than FKs so membership events can be projected before a
  -- replayed user/org snapshot arrives; each later snapshot completes it.
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id)
);

CREATE INDEX IF NOT EXISTS fuzequality_tenants_active_idx ON fuzequality.tenants (active, tenant_type);
CREATE INDEX IF NOT EXISTS fuzequality_memberships_principal_idx ON fuzequality.organization_memberships (principal_id, active);
