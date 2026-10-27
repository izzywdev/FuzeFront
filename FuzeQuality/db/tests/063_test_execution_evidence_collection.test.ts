import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/063_test_execution_evidence_collection.sql', import.meta.url),
  'utf8',
)

describe('test execution evidence collection migration', () => {
  it('retains provider collection outcomes in canonical and immutable execution storage', () => {
    expect(migration).toContain('ALTER TABLE fuzequality.test_executions')
    expect(migration).toContain('ALTER TABLE fuzequality.test_execution_versions')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS evidence_collection jsonb')
    expect(migration).toContain("jsonb_typeof(evidence_collection) = 'object'")
  })
})
