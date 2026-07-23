import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationUrl = new URL('../migrations/001_initial.sql', import.meta.url);
const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');

const requiredTables = [
  'repositories', 'repository_revisions', 'scan_runs', 'source_files',
  'api_documents', 'api_operations', 'api_parameters', 'api_responses',
  'frontend_packages', 'frontend_routes', 'frontend_components', 'frontend_states',
  'storybook_stories', 'test_suites', 'test_cases', 'test_expectations',
  'test_targets', 'coverage_evidence', 'requirements', 'acceptance_criteria',
  'flows', 'flow_requirements', 'flow_steps', 'flow_targets', 'analysis_runs',
  'suggestions', 'review_decisions', 'findings', 'coverage_snapshots',
  'sync_cursors', 'outbox_events', 'consumer_receipts',
];

test('migration is transactional, forward-only, and idempotent DDL', () => {
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE(?! IF NOT EXISTS)/i);
  assert.doesNotMatch(sql, /CREATE INDEX(?! IF NOT EXISTS)/i);
});

test('creates every normalized V1 evidence table', () => {
  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
  }
});

test('uses UUID primary keys and explicit graph relationships', () => {
  const uuidPrimaryKeys = sql.match(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/g) ?? [];
  assert.ok(uuidPrimaryKeys.length >= 28, `expected at least 28 UUID entity keys, found ${uuidPrimaryKeys.length}`);

  for (const relationship of [
    'repository_id uuid NOT NULL REFERENCES repositories(id)',
    'api_operation_id uuid NOT NULL REFERENCES api_operations(id)',
    'frontend_component_id uuid NOT NULL REFERENCES frontend_components(id)',
    'test_case_id uuid NOT NULL REFERENCES test_cases(id)',
    'requirement_id uuid NOT NULL REFERENCES requirements(id)',
    'flow_step_id uuid NOT NULL REFERENCES flow_steps(id)',
    'suggestion_id uuid NOT NULL REFERENCES suggestions(id)',
  ]) {
    assert.ok(sql.includes(relationship), `missing relationship: ${relationship}`);
  }
});

test('preserves idempotency and processing traceability', () => {
  assert.match(sql, /UNIQUE \(repository_id, commit_sha, scanner_version, configuration_version\)/);
  assert.match(sql, /UNIQUE \(consumer_group, event_id\)/);
  assert.match(sql, /UNIQUE \(topic, event_key\)/);
  assert.match(sql, /UNIQUE NULLS NOT DISTINCT \([\s\S]*expectation_kind, rule_version/);
  assert.match(sql, /correlation_id uuid NOT NULL/g);
  assert.match(sql, /policy_version text NOT NULL/g);
  assert.match(sql, /schema_version text NOT NULL/);
});

test('prevents credential-bearing repository URLs and weak suppressions', () => {
  assert.match(sql, /canonical_url !~\* ':[^']*\/\/[^']*:[^']+@'/);
  assert.match(sql, /finding_status <> 'suppressed'/);
  assert.match(sql, /owner_principal_id IS NOT NULL/);
  assert.match(sql, /suppression_expires_at IS NOT NULL/);
});
