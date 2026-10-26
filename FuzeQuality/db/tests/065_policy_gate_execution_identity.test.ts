import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/065_policy_gate_execution_identity.sql', import.meta.url),
  'utf8',
)

describe('policy-gate execution identity migration', () => {
  it('repairs legacy governance identities and installs a repository-scoped resolver', () => {
    expect(migration).toContain("WHERE kind IN ('policy', 'gate')")
    expect(migration).toContain('SET logical_id = canonical.logical_id')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION fuzequality.quality_artifact_logical_id')
    expect(migration).toContain('artifact.repository_id = selected_repository_id')
    expect(migration).toContain('artifact.logical_id = selected_artifact_id')
  })
})
