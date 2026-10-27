import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/046_repository_analysis_status.sql', import.meta.url), 'utf8')

test('repository analysis lifecycle is additive and identifies FuzeInfra LiteLLM review state', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_analysis jsonb/)
  assert.match(migration, /FuzeInfra LiteLLM review lifecycle/)
})
