import { describe, expect, it } from 'vitest'
import { executionPerformance } from './execution-performance'

describe('execution performance', () => {
  it('aggregates only explicit policy-gate execution pairs', () => {
    const rows = executionPerformance([
      { id: '1', repositoryId: 'repo', tenantId: 'org', revision: 'a', kind: 'ci', status: 'passed', name: 'auth', policyArtifactIds: ['policy'], gateArtifactIds: ['gate'] },
      { id: '2', repositoryId: 'repo', tenantId: 'org', revision: 'b', kind: 'ci', status: 'failed', name: 'auth', policyArtifactIds: ['policy'], gateArtifactIds: ['gate'], completedAt: '2026-01-02T00:00:00.000Z' },
      { id: '3', repositoryId: 'repo', tenantId: 'org', revision: 'c', kind: 'ci', status: 'passed', name: 'unlinked', policyArtifactIds: [], gateArtifactIds: ['gate'] },
    ])
    expect(rows).toEqual([{ policyArtifactId: 'policy', gateArtifactId: 'gate', passed: 1, failed: 1, cancelled: 0, running: 0, latestCompletedAt: '2026-01-02T00:00:00.000Z' }])
  })
})
