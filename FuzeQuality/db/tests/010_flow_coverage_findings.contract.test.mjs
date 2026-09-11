import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const migrationUrl = new URL('../migrations/010_flow_coverage_findings.sql', import.meta.url)
const sql = await readFile(fileURLToPath(migrationUrl), 'utf8')

test('flow coverage migration is additive and retry-safe', () => {
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS policy_version text/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS schema_version text/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS evidence_strength text/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS evidence jsonb/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS audit_history jsonb/)
  assert.match(sql, /ALTER TABLE fuzequality\.flows[\s\S]*ADD COLUMN IF NOT EXISTS details jsonb/)
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_findings_policy/)
})
