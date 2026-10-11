-- FQ-202/FQ-211: persisted, source-derived wireframe primitives for review.
ALTER TABLE fuzequality.repository_flow_candidates ADD COLUMN IF NOT EXISTS wireframe jsonb NOT NULL DEFAULT '{"kind":"sequence","nodes":[]}'::jsonb;
