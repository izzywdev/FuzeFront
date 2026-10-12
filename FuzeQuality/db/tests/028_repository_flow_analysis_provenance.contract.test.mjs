import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/028_repository_flow_analysis_provenance.sql', import.meta.url), 'utf8')

test('repository flow analysis provenance migration is additive and retry-safe', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS analysis_provenance jsonb/)
  assert.match(migration, /FuzeInfra LiteLLM provider, configured model, prompt version, and schema version/)
})
