import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('test execution head-repository migration', () => {
  it('retains fork provenance without blessing unknown legacy rows', () => {
    const migration = readFileSync(
      new URL('../migrations/061_test_execution_head_repository.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('test_executions\n  ADD COLUMN IF NOT EXISTS head_repository text')
    expect(migration).toContain('test_execution_versions\n  ADD COLUMN IF NOT EXISTS head_repository text')
    expect(migration).toContain('lower(head_repository)')
    expect(migration).not.toContain('UPDATE fuzequality.test_executions')
  })
})
