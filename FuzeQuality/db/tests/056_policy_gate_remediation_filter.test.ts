import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/056_policy_gate_remediation_filter.sql', import.meta.url),
  'utf8',
)

describe('policy gate remediation filter migration', () => {
  it('indexes the tenant, repository, action, and stable page order', () => {
    expect(migration).toContain('policy_gate_evaluations_remediation_page_idx')
    expect(migration).toContain('tenant_id, repository_id, remediation_action')
    expect(migration).toContain('created_at DESC, id DESC')
  })
})
