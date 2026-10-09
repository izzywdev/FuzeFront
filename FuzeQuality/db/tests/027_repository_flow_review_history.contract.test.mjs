import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('../migrations/027_repository_flow_review_history.sql', import.meta.url), 'utf8')

test('repository flow review history migration is additive and safe to retry', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reviewed_at/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reviewed_by/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS review_reason/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS fuzequality\.repository_flow_review_history/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS repository_flow_review_history_tenant_candidate_created_idx/)
})

test('repository flow review evidence is bound to both candidate and tenant', () => {
  assert.match(migration, /CHECK \(status IN \('confirmed', 'rejected'\)\)/)
  assert.match(migration, /FOREIGN KEY \(candidate_id, tenant_id\)/)
  assert.match(migration, /REFERENCES fuzequality\.repository_flow_candidates \(id, tenant_id\)/)
  assert.match(migration, /reviewed_by text NOT NULL/)
})
