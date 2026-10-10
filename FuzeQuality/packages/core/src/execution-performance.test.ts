import { describe, expect, it } from 'vitest'
import { executionOutcomeTrend, executionPerformance, filterTestExecutions, performanceWorkflowTarget } from './execution-performance'

describe('execution performance', () => {
  it('dispatches only an exact scanner-verified workflow_dispatch target', () => {
    const artifact = {
      id: 'load', repositoryId: 'repo', kind: 'load-test' as const, title: 'Load',
      sourcePath: '.github/workflows/load.yml', summary: 'Load workflow', evidence: [],
      execution: { provider: 'github-actions' as const, workflowPath: '.github/workflows/load.yml', trigger: 'workflow_dispatch' as const },
    }
    expect(performanceWorkflowTarget(artifact)).toBe('.github/workflows/load.yml')
    expect(performanceWorkflowTarget({ ...artifact, execution: undefined })).toBeUndefined()
    expect(performanceWorkflowTarget({ ...artifact, execution: { ...artifact.execution, workflowPath: '.github/workflows/other.yml' } })).toBeUndefined()
  })

  it('aggregates only explicit policy-gate execution pairs', () => {
    const rows = executionPerformance([
      { id: '1', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '1', attempt: 1, revision: 'a', kind: 'ci', status: 'passed', name: 'auth', policyArtifactIds: ['policy'], gateArtifactIds: ['gate'], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
      { id: '2', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '2', attempt: 1, revision: 'b', kind: 'ci', status: 'failed', name: 'auth', policyArtifactIds: ['policy', 'policy-other'], gateArtifactIds: ['gate', 'gate-other'], gateEvaluations: [{ policyArtifactId: 'policy', gateArtifactId: 'gate', status: 'failed' }], thresholds: [], evidenceLinks: [], completedAt: '2026-01-02T00:00:00.000Z' },
      { id: '3', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '3', attempt: 1, revision: 'c', kind: 'ci', status: 'passed', name: 'unlinked', policyArtifactIds: [], gateArtifactIds: ['gate'], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
    ], [
      { id: 'policy', repositoryId: 'repo', kind: 'policy', title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Require authentication', evidence: [] },
      { id: 'gate', repositoryId: 'repo', kind: 'gate', title: 'Authentication gate', sourcePath: '.github/workflows/auth.yml', summary: 'Enforce authentication', evidence: [] },
    ])
    expect(rows).toEqual([{ repositoryId: 'repo', policyArtifactId: 'policy', policyTitle: 'Authentication policy', policySourcePath: 'governance/auth.md', gateArtifactId: 'gate', gateTitle: 'Authentication gate', gateSourcePath: '.github/workflows/auth.yml', passed: 1, failed: 1, cancelled: 0, running: 0, latestCompletedAt: '2026-01-02T00:00:00.000Z' }])
  })

  it('keeps identical artifact identifiers isolated by repository', () => {
    const execution = (repositoryId: string, status: 'passed' | 'failed') => ({
      id: repositoryId,
      repositoryId,
      tenantId: 'org',
      provider: 'external' as const,
      externalRunId: repositoryId,
      attempt: 1,
      revision: 'a',
      kind: 'ci' as const,
      status,
      name: 'shared workflow',
      policyArtifactIds: ['policy'],
      gateArtifactIds: ['gate'],
      gateEvaluations: [{ policyArtifactId: 'policy', gateArtifactId: 'gate', status }],
      thresholds: [],
      evidenceLinks: [],
    })

    expect(executionPerformance([execution('repo-one', 'passed'), execution('repo-two', 'failed')])).toEqual([
      { repositoryId: 'repo-two', policyArtifactId: 'policy', gateArtifactId: 'gate', passed: 0, failed: 1, cancelled: 0, running: 0 },
      { repositoryId: 'repo-one', policyArtifactId: 'policy', gateArtifactId: 'gate', passed: 1, failed: 0, cancelled: 0, running: 0 },
    ])
  })
})

it('filters and trends only timestamped execution evidence', () => {
  const executions = [
    { id: 'one', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'one', attempt: 1, revision: 'a', kind: 'ci' as const, status: 'passed' as const, name: 'CI', completedAt: '2026-10-07T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
    { id: 'two', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'two', attempt: 1, revision: 'b', kind: 'load' as const, status: 'failed' as const, name: 'Load', completedAt: '2026-10-08T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
  ]
  expect(filterTestExecutions(executions, { kind: 'load', from: '2026-10-08T00:00:00.000Z' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { provider: 'github-actions' })).toEqual([])
  expect(filterTestExecutions(executions, { provider: 'external' })).toEqual(executions)
  expect(filterTestExecutions(executions, { revision: 'b' })).toEqual([executions[1]])
  expect(executionOutcomeTrend(executions)).toEqual([
    { date: '2026-10-07', passed: 1, failed: 0, cancelled: 0, running: 0 },
    { date: '2026-10-08', passed: 0, failed: 1, cancelled: 0, running: 0 },
  ])
})
