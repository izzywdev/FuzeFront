-- Preserve every revision-scoped artifact, including multiple Storybook stories
-- or test cases emitted from the same source file. Artifact IDs are the durable
-- identity; repository/revision/kind/path is provenance, not a unique key.
DO $$
DECLARE
  artifact_constraint text;
BEGIN
  SELECT conname INTO artifact_constraint
  FROM pg_constraint
  WHERE conrelid = 'fuzequality.repository_quality_artifacts'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (repository_id, revision, kind, source_path)'
  LIMIT 1;

  IF artifact_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE fuzequality.repository_quality_artifacts DROP CONSTRAINT %I',
      artifact_constraint
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS repository_quality_artifacts_source_idx
  ON fuzequality.repository_quality_artifacts (repository_id, revision, kind, source_path);
