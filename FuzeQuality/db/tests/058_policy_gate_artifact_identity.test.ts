import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('policy-gate artifact relationship identity migration', () => {
  it('replaces title uniqueness with policy and gate artifact identity', () => {
    const migration = readFileSync(
      new URL('../migrations/058_policy_gate_artifact_identity.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('DROP CONSTRAINT IF EXISTS policy_gate_evaluations_repository_id_revision_kind_title_key')
    expect(migration).toContain('policy_gate_evaluations_artifact_identity_key')
    expect(migration).toContain('policy_artifact_ids, gate_artifact_ids')
    expect(migration).toContain('jsonb_agg(value ORDER BY value)')
  })
})
