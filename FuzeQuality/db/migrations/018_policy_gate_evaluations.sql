-- FQ-204/FQ-212: revision-bound, reviewable policy-to-gate assessment.
CREATE TABLE IF NOT EXISTS fuzequality.policy_gate_evaluations (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  revision text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('unguarded-policy','guard-without-policy','contradictory-policy','ambiguous-policy')),
  severity text NOT NULL CHECK (severity IN ('high','medium','low')),
  title text NOT NULL,
  detail text NOT NULL,
  policy_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, revision, kind, title)
);
CREATE INDEX IF NOT EXISTS policy_gate_evaluations_tenant_idx
  ON fuzequality.policy_gate_evaluations (tenant_id, repository_id, created_at DESC);
