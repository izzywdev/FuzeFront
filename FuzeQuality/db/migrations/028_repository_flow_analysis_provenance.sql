-- FQ-203/FQ-210: retain the exact FuzeInfra LiteLLM configuration that
-- produced each reviewable flow proposal. Deterministic candidates have no
-- model provenance and keep this column NULL.
ALTER TABLE fuzequality.repository_flow_candidates
  ADD COLUMN IF NOT EXISTS analysis_provenance jsonb;

COMMENT ON COLUMN fuzequality.repository_flow_candidates.analysis_provenance IS
  'FuzeInfra LiteLLM provider, configured model, prompt version, and schema version used for this proposal.';
