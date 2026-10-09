-- FQ-202/FQ-210: UX-flow review decisions are durable human evidence. The
-- current decision remains convenient to query while every decision is kept
-- in an immutable, tenant-bound history ledger.
ALTER TABLE fuzequality.repository_flow_candidates
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS review_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS repository_flow_candidates_id_tenant_unique
  ON fuzequality.repository_flow_candidates (id, tenant_id);

CREATE TABLE IF NOT EXISTS fuzequality.repository_flow_review_history (
  id uuid PRIMARY KEY,
  candidate_id text NOT NULL,
  tenant_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  reviewed_by text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (candidate_id, tenant_id)
    REFERENCES fuzequality.repository_flow_candidates (id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS repository_flow_review_history_tenant_candidate_created_idx
  ON fuzequality.repository_flow_review_history (tenant_id, candidate_id, created_at DESC);
