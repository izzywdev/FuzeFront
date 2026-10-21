import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/064_normalize_test_execution_workflow_paths.sql', import.meta.url),
  'utf8',
)

describe('test execution workflow path normalization migration', () => {
  it('canonicalizes provider-qualified paths in current and immutable evidence', () => {
    expect(migration).toContain('UPDATE fuzequality.test_executions')
    expect(migration).toContain('UPDATE fuzequality.test_execution_versions')
    expect(migration).toContain("substring(workflow_path FROM '^(.+\\.ya?ml)@.+$')")
    expect(migration).toContain("workflow_path ~* '^.+\\.ya?ml@.+$'")
  })
})
