import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/045_test_execution_versions.sql', import.meta.url),
  'utf8',
)

describe('test execution version migration', () => {
  it('creates and backfills immutable lifecycle snapshots with a tenant-scoped index', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS fuzequality.test_execution_versions')
    expect(migration).toContain('versioned_at timestamptz NOT NULL DEFAULT clock_timestamp()')
    expect(migration).toContain('FROM fuzequality.test_executions AS execution')
    expect(migration).toContain('test_execution_versions_snapshot_idx')
    expect(migration).toContain('(tenant_id,repository_id,versioned_at DESC,provider,external_run_id,attempt,version_id DESC)')
  })
})
