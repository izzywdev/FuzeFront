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
       FROM (SELECT DISTINCT value
             FROM jsonb_array_elements_text(policy_artifact_ids) AS artifact(value)) AS canonical),
      '[]'::jsonb
    ),
    gate_artifact_ids = COALESCE(
      (SELECT jsonb_agg(value ORDER BY value)
       FROM (SELECT DISTINCT value
             FROM jsonb_array_elements_text(gate_artifact_ids) AS artifact(value)) AS canonical),
      '[]'::jsonb
    );

-- Rows with distinct legacy titles can collapse to the same canonical
-- relationship. Preserve their immutable review history on the strongest,
-- most recently reviewed survivor before removing duplicates.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER relationship AS survivor_id,
         row_number() OVER relationship AS relationship_position
  FROM fuzequality.policy_gate_evaluations
  WINDOW relationship AS (
    PARTITION BY repository_id, revision, kind, policy_artifact_ids, gate_artifact_ids
    ORDER BY (review_status <> 'proposed') DESC,
             reviewed_at DESC NULLS LAST,
             created_at DESC,
             id DESC
  )
)
UPDATE fuzequality.policy_gate_review_history AS history
SET evaluation_id = ranked.survivor_id
FROM ranked
WHERE ranked.relationship_position > 1
  AND history.evaluation_id = ranked.id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY repository_id, revision, kind, policy_artifact_ids, gate_artifact_ids
           ORDER BY (review_status <> 'proposed') DESC,
                    reviewed_at DESC NULLS LAST,
                    created_at DESC,
                    id DESC
         ) AS relationship_position
  FROM fuzequality.policy_gate_evaluations
)
DELETE FROM fuzequality.policy_gate_evaluations AS evaluation
USING ranked
WHERE evaluation.id = ranked.id
  AND ranked.relationship_position > 1;

-- Keep the unique index entry bounded even when a relationship contains many
-- long artifact identifiers. pgcrypto is installed by migration 001.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN artifact_identity_digest bytea
    GENERATED ALWAYS AS (
      digest(policy_artifact_ids::text || chr(31) || gate_artifact_ids::text, 'sha256')
    ) STORED;

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_artifact_identity_key
  UNIQUE (repository_id, revision, kind, artifact_identity_digest);
