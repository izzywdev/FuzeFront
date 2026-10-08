-- FQ-52: exclusions are time-bound governance records.  They never delete
-- test expectations and expiry makes the original gap visible again.
CREATE TABLE IF NOT EXISTS fuzequality.expectation_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expectation_id text NOT NULL REFERENCES fuzequality.test_expectations(id),
  tenant_id text NOT NULL,
  owner text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  decision_id uuid REFERENCES fuzequality.review_decisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS expectation_exclusions_active_idx
  ON fuzequality.expectation_exclusions (expectation_id, tenant_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS expectation_exclusions_expiry_idx
  ON fuzequality.expectation_exclusions (expires_at)
  WHERE revoked_at IS NULL;
