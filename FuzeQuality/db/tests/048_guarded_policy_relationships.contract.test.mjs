import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/048_guarded_policy_relationships.sql', import.meta.url), 'utf8')

test('successful policy-to-gate relationships are valid persisted evaluations', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS policy_gate_evaluations_kind_check/i)
  assert.match(migration, /'guarded-policy'/i)
})
