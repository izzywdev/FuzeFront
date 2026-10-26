-- FQ-206/FQ-214/FQ-215: make retained execution evidence addressable by the
-- stable policy/gate identity introduced after older observations were stored.
-- Policy and gate artifacts have one scanner observation per source path, so
-- the deterministic identity from a newer scan can safely repair legacy rows.
WITH canonical AS (
  SELECT DISTINCT ON (repository_id, kind, source_path)
         repository_id, kind, source_path, logical_id
  FROM fuzequality.repository_quality_artifacts
  WHERE kind IN ('policy', 'gate')
    AND logical_id <> id
  ORDER BY repository_id, kind, source_path, discovered_at DESC, id DESC
)
UPDATE fuzequality.repository_quality_artifacts AS artifact
SET logical_id = canonical.logical_id
FROM canonical
WHERE artifact.repository_id = canonical.repository_id
  AND artifact.kind = canonical.kind
  AND artifact.source_path = canonical.source_path
  AND artifact.logical_id = artifact.id;

CREATE OR REPLACE FUNCTION fuzequality.quality_artifact_logical_id(
  selected_repository_id uuid,
  selected_artifact_id text
) RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, fuzequality
AS $$
  SELECT COALESCE((
    SELECT artifact.logical_id
    FROM fuzequality.repository_quality_artifacts AS artifact
    WHERE artifact.repository_id = selected_repository_id
      AND (
        artifact.id = selected_artifact_id
        OR artifact.logical_id = selected_artifact_id
      )
    ORDER BY
      (artifact.id = selected_artifact_id) DESC,
      artifact.discovered_at DESC,
      artifact.id DESC
    LIMIT 1
  ), selected_artifact_id)
$$;
