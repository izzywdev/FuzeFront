import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/031_policy_gate_evidence_context.sql', import.meta.url), 'utf8')

test('policy gate evidence migration gives legacy findings a concrete, retry-safe scope', () => {
  assert.match(
    migration,
    /ALTER COLUMN scope SET DEFAULT '\{"sourcePaths":\["legacy:\/\/unknown"\],"subjects":\[\]\}'::jsonb/i,
  )
  assert.match(
    migration,
    /UPDATE fuzequality\.policy_gate_evaluations[\s\S]*SET scope = '\{"sourcePaths":\["legacy:\/\/unknown"\],"subjects":\[\]\}'::jsonb/i,
  )
  assert.match(migration, /jsonb_array_length\(scope->'sourcePaths'\) > 0/i)
})
