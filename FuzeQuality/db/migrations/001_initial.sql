-- FuzeQuality V1 authoritative evidence model.
-- Forward-only and safe to re-run. PostgreSQL 15+.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS fuzequality;

SET search_path TO fuzequality, public;

CREATE TABLE IF NOT EXISTS repositories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    provider text NOT NULL CHECK (provider IN ('github')),
    owner text NOT NULL,
    name text NOT NULL,
    canonical_url text NOT NULL,
    default_branch text NOT NULL,
    repository_kind text NOT NULL CHECK (repository_kind IN ('application', 'service', 'library', 'infrastructure', 'mixed')),
    installation_id text NOT NULL,
    configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, provider, owner, name),
    CHECK (canonical_url !~* '://[^/]+:[^/@]+@')
);

CREATE TABLE IF NOT EXISTS repository_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id uuid NOT NULL REFERENCES repositories(id),
    commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-fA-F]{40,64}$'),
    branch text NOT NULL,
    scanner_version text NOT NULL,
    configuration_version text NOT NULL,
    committed_at timestamptz,
    scanned_at timestamptz,
    status text NOT NULL CHECK (status IN ('requested', 'scanning', 'succeeded', 'failed', 'superseded')),
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_id, commit_sha, scanner_version, configuration_version)
);

CREATE TABLE IF NOT EXISTS scan_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    trigger_kind text NOT NULL CHECK (trigger_kind IN ('onboarding', 'manual', 'push', 'reconcile', 'retry')),
    status text NOT NULL CHECK (status IN ('requested', 'running', 'succeeded', 'failed')),
    correlation_id uuid NOT NULL,
    counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    redacted_error_summary text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    path text NOT NULL,
    language text,
    content_hash text NOT NULL,
    category text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_revision_id, path)
);

CREATE TABLE IF NOT EXISTS api_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    source_file_id uuid NOT NULL REFERENCES source_files(id),
    stable_key text NOT NULL,
    title text,
    api_version text,
    specification_version text NOT NULL,
    document_format text NOT NULL CHECK (document_format IN ('json', 'yaml')),
    content_hash text NOT NULL,
    validation_state text NOT NULL CHECK (validation_state IN ('valid', 'invalid', 'partial')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_revision_id, stable_key)
);

CREATE TABLE IF NOT EXISTS api_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_document_id uuid NOT NULL REFERENCES api_documents(id),
    stable_key text NOT NULL,
    operation_id text,
    method text NOT NULL CHECK (method IN ('GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE')),
    normalized_path text NOT NULL,
    summary text,
    tags text[] NOT NULL DEFAULT '{}',
    security jsonb NOT NULL DEFAULT '[]'::jsonb,
    deprecated boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (api_document_id, stable_key),
    UNIQUE (api_document_id, method, normalized_path)
);

CREATE TABLE IF NOT EXISTS api_parameters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_operation_id uuid NOT NULL REFERENCES api_operations(id),
    location text NOT NULL CHECK (location IN ('path', 'query', 'header', 'cookie', 'body')),
    name text NOT NULL,
    required boolean NOT NULL DEFAULT false,
    schema_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (api_operation_id, location, name)
);

CREATE TABLE IF NOT EXISTS api_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_operation_id uuid NOT NULL REFERENCES api_operations(id),
    status_pattern text NOT NULL,
    content_type text NOT NULL DEFAULT '',
    schema_hash text,
    schema_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (api_operation_id, status_pattern, content_type)
);

CREATE TABLE IF NOT EXISTS frontend_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    source_path text NOT NULL,
    package_name text NOT NULL,
    package_version text,
    framework text,
    build_system text,
    visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_revision_id, source_path)
);

CREATE TABLE IF NOT EXISTS frontend_routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    frontend_package_id uuid NOT NULL REFERENCES frontend_packages(id),
    parent_route_id uuid REFERENCES frontend_routes(id),
    source_file_id uuid REFERENCES source_files(id),
    stable_key text NOT NULL,
    route_path text NOT NULL,
    page_symbol text,
    role_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (frontend_package_id, stable_key)
);

CREATE TABLE IF NOT EXISTS frontend_components (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    frontend_package_id uuid NOT NULL REFERENCES frontend_packages(id),
    source_file_id uuid NOT NULL REFERENCES source_files(id),
    stable_key text NOT NULL,
    export_name text NOT NULL,
    component_kind text NOT NULL CHECK (component_kind IN ('page', 'feature', 'reusable', 'primitive')),
    is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (frontend_package_id, stable_key)
);

CREATE TABLE IF NOT EXISTS frontend_states (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    frontend_route_id uuid REFERENCES frontend_routes(id),
    frontend_component_id uuid REFERENCES frontend_components(id),
    state_key text NOT NULL,
    origin text NOT NULL CHECK (origin IN ('policy', 'static-analysis', 'reviewed-ai', 'manual')),
    priority text NOT NULL CHECK (priority IN ('required', 'recommended', 'not-applicable')),
    description text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((frontend_route_id IS NOT NULL)::int + (frontend_component_id IS NOT NULL)::int = 1),
    UNIQUE NULLS NOT DISTINCT (frontend_route_id, frontend_component_id, state_key)
);

CREATE TABLE IF NOT EXISTS storybook_stories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    frontend_component_id uuid NOT NULL REFERENCES frontend_components(id),
    source_file_id uuid NOT NULL REFERENCES source_files(id),
    story_id text NOT NULL,
    title text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    has_play_function boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (frontend_component_id, story_id)
);

CREATE TABLE IF NOT EXISTS test_suites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    source_file_id uuid NOT NULL REFERENCES source_files(id),
    stable_key text NOT NULL,
    framework text NOT NULL,
    title text NOT NULL,
    test_level text NOT NULL CHECK (test_level IN ('unit', 'integration', 'contract', 'e2e', 'accessibility', 'visual', 'unknown')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_revision_id, stable_key)
);

CREATE TABLE IF NOT EXISTS test_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_suite_id uuid NOT NULL REFERENCES test_suites(id),
    stable_key text NOT NULL,
    title_path text NOT NULL,
    source_line integer CHECK (source_line IS NULL OR source_line > 0),
    explicit_annotations jsonb NOT NULL DEFAULT '{}'::jsonb,
    assertion_count integer NOT NULL DEFAULT 0 CHECK (assertion_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (test_suite_id, stable_key)
);

CREATE TABLE IF NOT EXISTS requirements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    jira_key text NOT NULL,
    issue_type text NOT NULL,
    parent_requirement_id uuid REFERENCES requirements(id),
    summary text NOT NULL,
    normalized_description text NOT NULL DEFAULT '',
    jira_project text NOT NULL,
    jira_component text,
    requirement_status text NOT NULL,
    source_revision text NOT NULL,
    updated_at_source timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, jira_key, source_revision)
);

CREATE TABLE IF NOT EXISTS acceptance_criteria (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id uuid NOT NULL REFERENCES requirements(id),
    fingerprint text NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    normalized_text text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (requirement_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS flows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    stable_key text NOT NULL,
    title text NOT NULL,
    owner_principal_id uuid,
    flow_status text NOT NULL CHECK (flow_status IN ('proposed', 'confirmed', 'deprecated', 'suppressed')),
    origin text NOT NULL CHECK (origin IN ('jira', 'manual', 'reviewed-ai')),
    confirmed_revision integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, stable_key)
);

CREATE TABLE IF NOT EXISTS flow_requirements (
    flow_id uuid NOT NULL REFERENCES flows(id),
    requirement_id uuid NOT NULL REFERENCES requirements(id),
    relationship text NOT NULL CHECK (relationship IN ('defines', 'supports', 'conflicts')),
    PRIMARY KEY (flow_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS flow_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id uuid NOT NULL REFERENCES flows(id),
    position integer NOT NULL CHECK (position >= 0),
    actor text NOT NULL,
    action text NOT NULL,
    expected_outcome text NOT NULL,
    path_kind text NOT NULL CHECK (path_kind IN ('main', 'alternate', 'error', 'recovery')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (flow_id, position, path_kind)
);

CREATE TABLE IF NOT EXISTS test_expectations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_operation_id uuid REFERENCES api_operations(id),
    frontend_state_id uuid REFERENCES frontend_states(id),
    flow_step_id uuid REFERENCES flow_steps(id),
    acceptance_criterion_id uuid REFERENCES acceptance_criteria(id),
    expectation_kind text NOT NULL,
    priority text NOT NULL CHECK (priority IN ('required', 'recommended', 'not-applicable')),
    origin text NOT NULL CHECK (origin IN ('deterministic-rule', 'reviewed-ai', 'manual')),
    rule_version text NOT NULL,
    description text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (api_operation_id IS NOT NULL)::int +
        (frontend_state_id IS NOT NULL)::int +
        (flow_step_id IS NOT NULL)::int +
        (acceptance_criterion_id IS NOT NULL)::int = 1
    ),
    UNIQUE NULLS NOT DISTINCT (
        api_operation_id, frontend_state_id, flow_step_id, acceptance_criterion_id,
        expectation_kind, rule_version
    )
);

CREATE TABLE IF NOT EXISTS test_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_case_id uuid NOT NULL REFERENCES test_cases(id),
    api_operation_id uuid REFERENCES api_operations(id),
    frontend_route_id uuid REFERENCES frontend_routes(id),
    frontend_component_id uuid REFERENCES frontend_components(id),
    flow_step_id uuid REFERENCES flow_steps(id),
    mapping_method text NOT NULL CHECK (mapping_method IN ('annotation', 'operation-id', 'method-route', 'import-ast', 'title', 'semantic')),
    confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    review_state text NOT NULL CHECK (review_state IN ('not-required', 'proposed', 'confirmed', 'rejected', 'stale')),
    source_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (api_operation_id IS NOT NULL)::int +
        (frontend_route_id IS NOT NULL)::int +
        (frontend_component_id IS NOT NULL)::int +
        (flow_step_id IS NOT NULL)::int = 1
    ),
    UNIQUE NULLS NOT DISTINCT (
        test_case_id, api_operation_id, frontend_route_id, frontend_component_id,
        flow_step_id, mapping_method, source_revision_id
    )
);

CREATE TABLE IF NOT EXISTS coverage_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_expectation_id uuid NOT NULL REFERENCES test_expectations(id),
    test_case_id uuid NOT NULL REFERENCES test_cases(id),
    test_target_id uuid REFERENCES test_targets(id),
    evidence_type text NOT NULL CHECK (evidence_type IN ('explicit', 'generated', 'deterministic', 'semantic')),
    strength numeric(5,4) NOT NULL CHECK (strength >= 0 AND strength <= 1),
    source_revision_id uuid NOT NULL REFERENCES repository_revisions(id),
    accepted boolean NOT NULL DEFAULT false,
    accepted_by_principal_id uuid,
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (test_expectation_id, test_case_id, source_revision_id)
);

CREATE TABLE IF NOT EXISTS flow_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_step_id uuid NOT NULL REFERENCES flow_steps(id),
    api_operation_id uuid REFERENCES api_operations(id),
    frontend_route_id uuid REFERENCES frontend_routes(id),
    frontend_component_id uuid REFERENCES frontend_components(id),
    test_case_id uuid REFERENCES test_cases(id),
    mapping_method text NOT NULL CHECK (mapping_method IN ('explicit', 'deterministic', 'semantic', 'manual')),
    confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    review_state text NOT NULL CHECK (review_state IN ('not-required', 'proposed', 'confirmed', 'rejected', 'stale')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (api_operation_id IS NOT NULL)::int +
        (frontend_route_id IS NOT NULL)::int +
        (frontend_component_id IS NOT NULL)::int +
        (test_case_id IS NOT NULL)::int = 1
    ),
    UNIQUE NULLS NOT DISTINCT (
        flow_step_id, api_operation_id, frontend_route_id, frontend_component_id,
        test_case_id, mapping_method
    )
);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    requirement_id uuid REFERENCES requirements(id),
    repository_revision_id uuid REFERENCES repository_revisions(id),
    prompt_version text NOT NULL,
    model_identity text NOT NULL,
    output_schema_version text NOT NULL,
    status text NOT NULL CHECK (status IN ('requested', 'running', 'succeeded', 'failed', 'rejected')),
    correlation_id uuid NOT NULL,
    token_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
    cost_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    redacted_error_summary text,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CHECK ((requirement_id IS NOT NULL)::int + (repository_revision_id IS NOT NULL)::int >= 1)
);

CREATE TABLE IF NOT EXISTS suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id),
    suggestion_type text NOT NULL,
    subject_kind text NOT NULL,
    subject_id uuid NOT NULL,
    proposed_payload jsonb NOT NULL,
    confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence jsonb NOT NULL,
    suggestion_state text NOT NULL CHECK (suggestion_state IN ('proposed', 'confirmed', 'edited', 'rejected', 'merged', 'expired', 'stale')),
    source_revision text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    UNIQUE (analysis_run_id, suggestion_type, subject_kind, subject_id, source_revision)
);

CREATE TABLE IF NOT EXISTS review_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id uuid NOT NULL REFERENCES suggestions(id),
    organization_id uuid NOT NULL,
    actor_principal_id uuid NOT NULL,
    decision text NOT NULL CHECK (decision IN ('confirm', 'edit-confirm', 'reject', 'merge', 'suppress', 'approve-test')),
    edited_payload jsonb,
    reason text,
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (suggestion_id, actor_principal_id, decision, correlation_id)
);

CREATE TABLE IF NOT EXISTS findings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    finding_type text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    subject_kind text NOT NULL,
    subject_id uuid NOT NULL,
    finding_status text NOT NULL CHECK (finding_status IN ('open', 'resolved', 'suppressed', 'stale')),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    owner_principal_id uuid,
    suppression_reason text,
    suppression_expires_at timestamptz,
    policy_version text NOT NULL,
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (finding_status <> 'suppressed' OR (owner_principal_id IS NOT NULL AND suppression_reason IS NOT NULL AND suppression_expires_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS coverage_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    scope_kind text NOT NULL,
    scope_id uuid,
    revision_set jsonb NOT NULL,
    policy_version text NOT NULL,
    totals jsonb NOT NULL,
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (correlation_id),
    UNIQUE NULLS NOT DISTINCT (organization_id, scope_kind, scope_id, policy_version, created_at)
);

CREATE TABLE IF NOT EXISTS sync_cursors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('github', 'jira', 'chroma')),
    source_key text NOT NULL,
    cursor_value text,
    freshness_status text NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'failed', 'unknown')),
    last_success_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, source_type, source_key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    topic text NOT NULL,
    event_type text NOT NULL,
    schema_version text NOT NULL,
    event_key text NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    payload jsonb NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    last_redacted_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (topic, event_key)
);

CREATE TABLE IF NOT EXISTS consumer_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_group text NOT NULL,
    event_id uuid NOT NULL,
    topic text NOT NULL,
    partition_number integer NOT NULL CHECK (partition_number >= 0),
    event_offset bigint NOT NULL CHECK (event_offset >= 0),
    correlation_id uuid NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consumer_group, event_id),
    UNIQUE (consumer_group, topic, partition_number, event_offset)
);

CREATE INDEX IF NOT EXISTS repository_revisions_repository_status_idx ON repository_revisions (repository_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_runs_revision_idx ON scan_runs (repository_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_operations_lookup_idx ON api_operations (method, normalized_path);
CREATE INDEX IF NOT EXISTS frontend_routes_path_idx ON frontend_routes (route_path);
CREATE INDEX IF NOT EXISTS test_cases_title_idx ON test_cases (title_path);
CREATE INDEX IF NOT EXISTS requirements_current_idx ON requirements (organization_id, jira_key, active, updated_at_source DESC);
CREATE INDEX IF NOT EXISTS suggestions_queue_idx ON suggestions (suggestion_state, suggestion_type, created_at);
CREATE INDEX IF NOT EXISTS findings_queue_idx ON findings (organization_id, finding_status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS coverage_snapshots_scope_idx ON coverage_snapshots (organization_id, scope_kind, scope_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_events (available_at, created_at) WHERE published_at IS NULL;

COMMIT;
