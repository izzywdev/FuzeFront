-- FQ-202 / FQ-203: a title is presentation, not flow identity. Multiple
-- independently grounded candidates may legitimately share a title.
ALTER TABLE fuzequality.repository_flow_candidates
  DROP CONSTRAINT IF EXISTS repository_flow_candidates_repository_id_revision_title_source_key;

COMMENT ON COLUMN fuzequality.repository_flow_candidates.id IS
  'Stable hash of repository, revision, source, and grounded flow content; preserves independent same-title candidates.';
