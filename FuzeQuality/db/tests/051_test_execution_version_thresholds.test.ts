import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/051_test_execution_version_thresholds.sql', import.meta.url),
  'utf8',
)

describe('test execution version threshold migration', () => {
  it('adds and snapshots evaluated thresholds without rewriting lifecycle history', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS thresholds jsonb')
    expect(migration).toContain('INSERT INTO fuzequality.test_execution_versions')
    expect(migration).toContain('version.thresholds = execution.thresholds')
    expect(migration).toContain('jsonb_array_length(execution.thresholds) > 0')
  })
})
