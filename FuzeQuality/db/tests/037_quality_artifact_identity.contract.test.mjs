import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/037_quality_artifact_identity.sql', import.meta.url), 'utf8')

test('artifact persistence permits multiple revision-scoped records from one source file', () => {
  assert.match(migration, /pg_get_constraintdef\(oid\) = 'UNIQUE \(repository_id, revision, kind, source_path\)'/i)
  assert.match(migration, /DROP CONSTRAINT %I/i)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS repository_quality_artifacts_source_idx/i)
})
