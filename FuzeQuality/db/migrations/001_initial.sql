CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS fuzequality;

CREATE TABLE IF NOT EXISTS fuzequality.repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'github',
  owner text NOT NULL,
  name text NOT NULL,
  canonical_url text NOT NULL,
  default_branch text NOT NULL,
  kind text NOT NULL,
  installation_id text,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scan_at timestamptz,
  last_scan_status text NOT NULL DEFAULT 'never',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, owner, name)
);

CREATE TABLE IF NOT EXISTS fuzequality.repository_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  commit_sha text NOT NULL,
  branch text NOT NULL,
  scanner_version text NOT NULL,
  config_version text NOT NULL,
  status text NOT NULL,
  committed_at timestamptz,
  scanned_at timestamptz,
  UNIQUE (repository_id, commit_sha, scanner_version, config_version)
);

CREATE TABLE IF NOT EXISTS fuzequality.scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  revision_id uuid REFERENCES fuzequality.repository_revisions(id),
  trigger text NOT NULL,
  status text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS fuzequality.source_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES fuzequality.repository_revisions(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text,
  content_hash text NOT NULL,
  category text NOT NULL,
  UNIQUE (revision_id, path)
);

CREATE TABLE IF NOT EXISTS fuzequality.api_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES fuzequality.repository_revisions(id) ON DELETE CASCADE,
  source_path text NOT NULL,
  title text,
  version text,
  format text NOT NULL,
  content_hash text NOT NULL,
  validation_state text NOT NULL,
  UNIQUE (revision_id, source_path)
);

CREATE TABLE IF NOT EXISTS fuzequality.api_operations (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  document_path text NOT NULL,
  operation_id text,
  method text NOT NULL,
  path text NOT NULL,
  summary text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  security boolean NOT NULL DEFAULT false,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.frontend_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  revision_id uuid REFERENCES fuzequality.repository_revisions(id),
  package_name text NOT NULL,
  source_path text NOT NULL,
  framework text,
  version text,
  is_public boolean NOT NULL DEFAULT false,
  UNIQUE (repository_id, package_name, source_path)
);

CREATE TABLE IF NOT EXISTS fuzequality.frontend_surfaces (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  package_name text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  source_path text NOT NULL,
  route_path text,
  is_public boolean NOT NULL DEFAULT false,
  states jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_story boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.test_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  revision_id uuid REFERENCES fuzequality.repository_revisions(id),
  framework text NOT NULL,
  source_path text NOT NULL,
  title text NOT NULL,
  test_level text NOT NULL
);

CREATE TABLE IF NOT EXISTS fuzequality.test_cases (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  framework text NOT NULL,
  test_level text NOT NULL,
  title text NOT NULL,
  source_path text NOT NULL,
  assertion_count integer NOT NULL DEFAULT 0,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.test_expectations (
  id text PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  priority text NOT NULL,
  rule text NOT NULL,
  coverage text NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, kind)
);

CREATE TABLE IF NOT EXISTS fuzequality.requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jira_key text NOT NULL UNIQUE,
  issue_type text NOT NULL,
  parent_key text,
  summary text NOT NULL,
  normalized_description text NOT NULL DEFAULT '',
  project text NOT NULL,
  component text,
  status text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS fuzequality.acceptance_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES fuzequality.requirements(id),
  fingerprint text NOT NULL,
  position integer NOT NULL,
  normalized_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (requirement_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS fuzequality.flows (
  id text PRIMARY KEY,
  requirement_id uuid REFERENCES fuzequality.requirements(id),
  title text NOT NULL,
  owner text,
  origin text NOT NULL,
  status text NOT NULL,
  confirmed_revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.flow_steps (
  id text PRIMARY KEY,
  flow_id text NOT NULL REFERENCES fuzequality.flows(id) ON DELETE CASCADE,
  position integer NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  expected_outcome text NOT NULL,
  variant text NOT NULL,
  target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (flow_id, position, variant)
);

CREATE TABLE IF NOT EXISTS fuzequality.analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid REFERENCES fuzequality.requirements(id),
  prompt_version text NOT NULL,
  model text NOT NULL,
  schema_version text NOT NULL,
  status text NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS fuzequality.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES fuzequality.requirements(id),
  type text NOT NULL,
  title text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  source_fingerprint text NOT NULL
);

CREATE TABLE IF NOT EXISTS fuzequality.review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES fuzequality.suggestions(id),
  actor text NOT NULL,
  decision text NOT NULL,
  edited_payload jsonb,
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.findings (
  id text PRIMARY KEY,
  repository_id uuid REFERENCES fuzequality.repositories(id),
  subject_id text,
  type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  owner text,
  suppression_expiry timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.coverage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  revision_set jsonb NOT NULL,
  policy_version text NOT NULL,
  totals jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuzequality.sync_cursors (
  source_type text NOT NULL,
  source_key text NOT NULL,
  cursor text,
  last_success_at timestamptz,
  freshness_status text NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (source_type, source_key)
);

CREATE TABLE IF NOT EXISTS fuzequality.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  event_key text,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE TABLE IF NOT EXISTS fuzequality.consumer_receipts (
  consumer_group text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);

CREATE INDEX IF NOT EXISTS idx_api_operations_repo ON fuzequality.api_operations(repository_id);
CREATE INDEX IF NOT EXISTS idx_frontend_surfaces_repo ON fuzequality.frontend_surfaces(repository_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_repo ON fuzequality.test_cases(repository_id);
CREATE INDEX IF NOT EXISTS idx_expectations_subject ON fuzequality.test_expectations(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_findings_open ON fuzequality.findings(status, severity);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON fuzequality.outbox_events(created_at) WHERE published_at IS NULL;
