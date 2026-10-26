import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/068_backfill_test_execution_branches.sql', import.meta.url),
  'utf8',
)

describe('legacy test execution branch backfill', () => {
  it('restores known default-branch provenance on canonical and immutable GitHub evidence', () => {
    expect(migration).toContain('UPDATE fuzequality.test_executions AS execution')
    expect(migration).toContain('UPDATE fuzequality.test_execution_versions AS version')
    expect(migration.match(/SET branch = repository\.default_branch/g)).toHaveLength(2)
    expect(migration.match(/provider = 'github-actions'/g)).toHaveLength(2)
    expect(migration).toContain('execution.branch IS NULL')
    expect(migration).toContain('version.branch IS NULL')
  })

  it('does not invent branch provenance for external producers', () => {
    expect(migration).not.toMatch(/provider\s*(?:<>|!=)\s*'github-actions'/)
    expect(migration).not.toContain("provider = 'external'")
  })
})
