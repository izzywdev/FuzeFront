import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/052_test_execution_branch.sql', import.meta.url),
  'utf8',
)

describe('test execution branch migration', () => {
  it('retains branch provenance on canonical and immutable execution rows', () => {
    expect(migration).toContain('ALTER TABLE fuzequality.test_executions')
    expect(migration).toContain('ALTER TABLE fuzequality.test_execution_versions')
    expect(migration.match(/ADD COLUMN IF NOT EXISTS branch text/g)).toHaveLength(2)
    expect(migration).toContain('test_executions_branch_idx')
  })
})
