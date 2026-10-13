-- FQ-205/FQ-213: repository-policy recommendations require an explicit human decision.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'proposed'
    CHECK (review_status IN ('proposed','accepted','dismissed')),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
