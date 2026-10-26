import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/055_policy_gate_remediation_actions.sql', import.meta.url),
  'utf8',
)

describe('policy gate remediation action migration', () => {
  it('backfills every finding kind before enforcing the action contract', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS remediation_action text')
    expect(migration).toContain("WHEN 'unguarded-policy' THEN 'build-gate'")
    expect(migration).toContain("WHEN 'guard-without-policy' THEN 'build-policy'")
    expect(migration.match(/THEN 'disambiguate-policy'/g)).toHaveLength(2)
    expect(migration).toContain("ELSE 'align-policy-gate'")
    expect(migration).toContain('ALTER COLUMN remediation_action SET NOT NULL')
    expect(migration).toContain('policy_gate_evaluations_remediation_action_check')
  })
})
