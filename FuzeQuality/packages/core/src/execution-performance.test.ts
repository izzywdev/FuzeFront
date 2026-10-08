import { describe, expect, it } from 'vitest'
import { executionOutcomeTrend, executionPerformance, filterTestExecutions } from './execution-performance'

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

it('filters and trends only timestamped execution evidence', () => {
  const executions = [
    { id: 'one', repositoryId: 'repo', tenantId: 'org', revision: 'a', kind: 'ci' as const, status: 'passed' as const, name: 'CI', completedAt: '2026-10-07T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [] },
    { id: 'two', repositoryId: 'repo', tenantId: 'org', revision: 'b', kind: 'load' as const, status: 'failed' as const, name: 'Load', completedAt: '2026-10-08T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [] },
  ]
  expect(filterTestExecutions(executions, { kind: 'load', from: '2026-10-08T00:00:00.000Z' })).toEqual([executions[1]])
  expect(executionOutcomeTrend(executions)).toEqual([
    { date: '2026-10-07', passed: 1, failed: 0, cancelled: 0, running: 0 },
    { date: '2026-10-08', passed: 0, failed: 1, cancelled: 0, running: 0 },
  ])
})
