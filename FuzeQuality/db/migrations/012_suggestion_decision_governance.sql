-- FQ-47: decisions are immutable governance records, not merely a suggestion
-- state transition. Existing rows remain valid and receive explicit legacy
-- provenance rather than being rewritten or discarded.
ALTER TABLE fuzequality.review_decisions
  ADD COLUMN IF NOT EXISTS tenant_id text,
  ADD COLUMN IF NOT EXISTS original_payload jsonb,
  ADD COLUMN IF NOT EXISTS owner text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_suggestion_id uuid REFERENCES fuzequality.suggestions(id);

UPDATE fuzequality.review_decisions
SET tenant_id = COALESCE(tenant_id, 'legacy'),
    original_payload = COALESCE(original_payload, '{}'::jsonb)
WHERE tenant_id IS NULL OR original_payload IS NULL;

ALTER TABLE fuzequality.review_decisions
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN original_payload SET NOT NULL;

CREATE INDEX IF NOT EXISTS review_decisions_suggestion_decided_idx
  ON fuzequality.review_decisions (suggestion_id, decided_at DESC);
