import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/044_test_execution_snapshot_membership.sql', import.meta.url),
  'utf8',
)

describe('test execution snapshot membership migration', () => {
  it('indexes the immutable tenant-scoped ingestion boundary', () => {
    expect(migration).toContain('test_executions_snapshot_membership_idx')
    expect(migration).toContain('(tenant_id, repository_id, created_at DESC)')
  })
})
