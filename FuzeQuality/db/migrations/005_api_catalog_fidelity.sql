ALTER TABLE fuzequality.api_operations
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN fuzequality.api_operations.details IS
  'Versioned OpenAPI catalog metadata including dialect, document identity, bundled source provenance, media types, servers, and security details.';
