-- FQ-197/FQ-203/FQ-210: requirement-analysis cursors and dependency failures
-- are organization-owned state. Legacy global cursors cannot be attributed
-- safely, so discard them and force one incremental baseline per tenant.
ALTER TABLE fuzequality.sync_cursors
  ADD COLUMN IF NOT EXISTS tenant_id text;

DELETE FROM fuzequality.sync_cursors WHERE tenant_id IS NULL;

ALTER TABLE fuzequality.sync_cursors
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE fuzequality.sync_cursors
  DROP CONSTRAINT IF EXISTS sync_cursors_pkey;

ALTER TABLE fuzequality.sync_cursors
  ADD CONSTRAINT sync_cursors_pkey PRIMARY KEY (tenant_id, source_type, source_key);
