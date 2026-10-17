-- FQ-204/FQ-212: display titles are not relationship identity. Separate
-- policies may intentionally share a filename/title in different services.
ALTER TABLE fuzequality.policy_gate_evaluations
  DROP CONSTRAINT IF EXISTS policy_gate_evaluations_repository_id_revision_kind_title_key;

-- Artifact relationships are sets. Canonicalize historical arrays before the
-- new constraint is installed so a re-analysis cannot duplicate a relationship
-- solely because discovery returned its artifacts in a different order.
UPDATE fuzequality.policy_gate_evaluations
SET policy_artifact_ids = COALESCE(
      (SELECT jsonb_agg(value ORDER BY value)
       FROM jsonb_array_elements_text(policy_artifact_ids) AS artifact(value)),
      '[]'::jsonb
    ),
    gate_artifact_ids = COALESCE(
      (SELECT jsonb_agg(value ORDER BY value)
       FROM jsonb_array_elements_text(gate_artifact_ids) AS artifact(value)),
      '[]'::jsonb
    );

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_artifact_identity_key
  UNIQUE (repository_id, revision, kind, policy_artifact_ids, gate_artifact_ids);
