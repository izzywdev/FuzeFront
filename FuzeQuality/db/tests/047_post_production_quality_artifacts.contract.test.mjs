import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/047_post_production_quality_artifacts.sql', import.meta.url), 'utf8')

test('post-production workflows are retained as repository quality artifacts', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS repository_quality_artifacts_kind_check/i)
  assert.match(migration, /'post-production-test'/i)
})
