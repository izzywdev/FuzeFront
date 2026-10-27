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
    expect(migration).toContain('PARTITION BY repository_id, revision, kind, policy_artifact_ids, gate_artifact_ids')
    expect(migration).toContain('jsonb_agg(value ORDER BY value)')
    expect(migration).toContain('SELECT DISTINCT value')
    expect(migration).toContain('UPDATE fuzequality.policy_gate_review_history AS history')
    expect(migration).toContain('DELETE FROM fuzequality.policy_gate_evaluations AS evaluation')
    expect(migration).toContain('artifact_identity_digest bytea')
    expect(migration).toContain("digest(policy_artifact_ids::text || chr(31) || gate_artifact_ids::text, 'sha256')")
    expect(migration).toContain('UNIQUE (repository_id, revision, kind, artifact_identity_digest)')
  })
})
