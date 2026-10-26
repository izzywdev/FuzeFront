-- FQ-203/FQ-210: keep the reviewed repository-intelligence lifecycle distinct
-- from deterministic catalog scanning so operators can see LiteLLM failures.
ALTER TABLE fuzequality.repositories
  ADD COLUMN IF NOT EXISTS last_analysis jsonb;

COMMENT ON COLUMN fuzequality.repositories.last_analysis IS
  'Revision-scoped deterministic governance and FuzeInfra LiteLLM review lifecycle, counts, and safe failure code.';
