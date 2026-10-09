import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/025_test_execution_provider_identity.sql', import.meta.url), 'utf8')

test('execution identity retains provider run attempts independently of source URLs', () => {
  assert.match(migration, /external_run_id text/i)
  assert.match(migration, /attempt integer/i)
  assert.match(migration, /UNIQUE INDEX[\s\S]*repository_id, provider, external_run_id, attempt/i)
  assert.match(migration, /DROP CONSTRAINT IF EXISTS test_executions_repository_id_revision_kind_name_source_url_key/i)
})
