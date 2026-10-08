BEGIN;

ALTER TABLE fuzequality.findings ADD COLUMN IF NOT EXISTS confidence numeric(4,3);
ALTER TABLE fuzequality.findings ADD COLUMN IF NOT EXISTS source_passages jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fuzequality.findings ADD COLUMN IF NOT EXISTS affected_flow_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fuzequality.findings ADD COLUMN IF NOT EXISTS affected_target_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fuzequality.findings ADD COLUMN IF NOT EXISTS remediation_options jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE fuzequality.findings DROP CONSTRAINT IF EXISTS findings_confidence_range;
ALTER TABLE fuzequality.findings ADD CONSTRAINT findings_confidence_range
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

CREATE INDEX IF NOT EXISTS findings_requirement_review_idx
  ON fuzequality.findings (subject_id, status, severity)
  WHERE policy_version = 'requirement-review-v1';

COMMIT;
