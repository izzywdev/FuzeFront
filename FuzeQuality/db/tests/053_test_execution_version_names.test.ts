import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/053_test_execution_version_names.sql', import.meta.url),
  'utf8',
)

describe('test execution version name migration', () => {
  it('adds, backfills, and requires the suite name used by snapshot filters', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS name text')
    expect(migration).toContain('UPDATE fuzequality.test_execution_versions AS version')
    expect(migration).toContain('version.external_run_id = execution.external_run_id')
    expect(migration).toContain('version.attempt = execution.attempt')
    expect(migration).toContain('ALTER COLUMN name SET NOT NULL')
  })
})
