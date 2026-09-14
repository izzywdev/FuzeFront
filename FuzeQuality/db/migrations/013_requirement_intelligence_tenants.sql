-- FQ-195: Jira-derived intelligence is organization data.  Legacy rows stay
-- deliberately unassigned so an organization API cannot expose them.
ALTER TABLE fuzequality.requirements ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE fuzequality.requirements DROP CONSTRAINT IF EXISTS requirements_jira_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS requirements_tenant_jira_key_idx
  ON fuzequality.requirements (tenant_id, jira_key) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS requirements_tenant_active_idx
  ON fuzequality.requirements (tenant_id, active, jira_key);

-- Audit records must resolve through a tenant-owned suggestion.  Existing
-- legacy decisions retain history but cannot be returned to an organization.
CREATE INDEX IF NOT EXISTS suggestions_requirement_idx ON fuzequality.suggestions (requirement_id);
CREATE INDEX IF NOT EXISTS flows_requirement_idx ON fuzequality.flows (requirement_id);
