CREATE TABLE IF NOT EXISTS fuzequality.admin_context_audits (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  source_tenant_id text NOT NULL,
  target_tenant_id text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_context_audits_actor_idx
  ON fuzequality.admin_context_audits (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_context_audits_target_idx
  ON fuzequality.admin_context_audits (target_tenant_id, created_at DESC);
