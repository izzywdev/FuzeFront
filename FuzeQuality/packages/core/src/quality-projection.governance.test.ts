import { describe, expect, it } from 'vitest'
import { policyGateFindings } from './quality-projection'

describe('governance quality projection', () => {
  it('promotes persisted governance evaluations to portfolio findings', () => {
    const findings = policyGateFindings([{ id: 'eval', repositoryId: 'repo', tenantId: 'org', revision: 'abc', kind: 'unguarded-policy', severity: 'high', title: 'No gate', detail: 'Missing gate', policyArtifactIds: ['policy'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['policy.md'], subjects: ['authentication'] }, recommendation: 'Add a gate', reviewStatus: 'proposed', createdAt: '2026-01-01T00:00:00.000Z' }])
    expect(findings[0]).toMatchObject({ type: 'policy-gate-unguarded-policy', severity: 'high', remediation: 'Add a gate' })
  })
})
