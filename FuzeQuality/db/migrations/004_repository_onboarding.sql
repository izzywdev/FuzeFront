-- FQ-18: repository registrations and their configuration are tenant-owned.
ALTER TABLE fuzequality.repositories
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'legacy';

ALTER TABLE fuzequality.repositories
  DROP CONSTRAINT IF EXISTS repositories_provider_owner_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS repositories_tenant_provider_owner_name_key
  ON fuzequality.repositories (tenant_id, provider, lower(owner), lower(name));
