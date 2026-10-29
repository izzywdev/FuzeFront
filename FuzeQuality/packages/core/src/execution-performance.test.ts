import { describe, expect, it } from 'vitest'
import { executableWorkflowTarget, executionOutcomeTrend, executionPerformance, filterTestExecutions, isPreferredWorkflowExecutionArtifact, performanceDispatchRevision, performanceWorkflowTarget, validateWorkflowDispatchInputs } from './execution-performance'

describe('execution performance', () => {
  it('dispatches only the immutable source commit that produced the current catalog', () => {
    const repository = {
      id: 'repo', owner: 'fuze', name: 'sample', canonicalUrl: 'https://github.com/fuze/sample',
      defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [],
      jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const,
      lastScanRevision: 'catalog',
      lastScanDetails: {
        sourceRevision: 'a'.repeat(40), catalogRevision: 'catalog', scannerVersion: '1.5.0',
        configVersion: 'config', partial: false, candidates: [],
        counts: { candidates: 0, operations: 0, frontendSurfaces: 0, tests: 0, diagnostics: 0 },
      },
    }
    expect(performanceDispatchRevision(repository)).toBe('a'.repeat(40))
    expect(performanceDispatchRevision({ ...repository, lastScanDetails: { ...repository.lastScanDetails, sourceRevision: 'main' } })).toBeUndefined()
    expect(performanceDispatchRevision({ ...repository, lastScanRevision: 'different-catalog' })).toBeUndefined()
    expect(performanceDispatchRevision({ ...repository, lastScanDetails: undefined })).toBeUndefined()
  })

  it('dispatches only an exact scanner-verified workflow_dispatch target', () => {
    const artifact = {
      id: 'load', repositoryId: 'repo', kind: 'load-test' as const, title: 'Load',
      sourcePath: '.github/workflows/load.yml', summary: 'Load workflow', evidence: [],
      execution: { provider: 'github-actions' as const, workflowPath: '.github/workflows/load.yml', trigger: 'workflow_dispatch' as const },
    }
    expect(performanceWorkflowTarget(artifact)).toBe('.github/workflows/load.yml')
    expect(performanceWorkflowTarget({ ...artifact, execution: undefined })).toBeUndefined()
    expect(performanceWorkflowTarget({ ...artifact, execution: { ...artifact.execution, workflowPath: '.github/workflows/other.yml' } })).toBeUndefined()
    const requiredInputArtifact = { ...artifact, execution: { ...artifact.execution, requiredInputs: ['environment'] } }
    expect(performanceWorkflowTarget(requiredInputArtifact)).toBe('.github/workflows/load.yml')
    expect(validateWorkflowDispatchInputs(requiredInputArtifact, { environment: ' staging ' })).toEqual({
      success: true,
      inputs: { environment: 'staging' },
    })
    expect(validateWorkflowDispatchInputs(requiredInputArtifact, {})).toEqual({
      success: false,
      missing: ['environment'],
      unexpected: [],
    })
    expect(validateWorkflowDispatchInputs(requiredInputArtifact, { environment: 'staging', unsafe: 'extra' })).toEqual({
      success: false,
      missing: [],
      unexpected: ['unsafe'],
    })
    expect(executableWorkflowTarget({ ...artifact, kind: 'integration-test' })).toBe('.github/workflows/load.yml')
    expect(executableWorkflowTarget({ ...artifact, kind: 'post-production-test' })).toBe('.github/workflows/load.yml')
    expect(executableWorkflowTarget({ ...artifact, kind: 'test-plan' })).toBeUndefined()
    expect(executableWorkflowTarget({
      ...artifact,
      sourcePath: '.github/workflows/load/test.yml',
      execution: { ...artifact.execution, workflowPath: '.github/workflows/load/test.yml' },
    })).toBeUndefined()
  })

  it('dispatches only the preferred classification of a shared workflow', () => {
    const integration = {
      id: 'integration', repositoryId: 'repo', kind: 'integration-test' as const,
      title: 'System checks', sourcePath: '.github/workflows/verify.yml',
      summary: 'Integration workflow', evidence: [],
    }
    const load = { ...integration, id: 'load', kind: 'load-test' as const, title: 'Load checks' }
    const otherRepository = { ...integration, id: 'other', repositoryId: 'other-repo' }

    expect(isPreferredWorkflowExecutionArtifact(load, [integration, load])).toBe(true)
    expect(isPreferredWorkflowExecutionArtifact(integration, [integration, load])).toBe(false)
    expect(isPreferredWorkflowExecutionArtifact(integration, [integration, otherRepository])).toBe(true)
    expect(isPreferredWorkflowExecutionArtifact(
      { ...integration, kind: 'test-plan' },
      [integration],
    )).toBe(false)
  })

  it('aggregates only explicit policy-gate execution pairs', () => {
    const rows = executionPerformance([
      { id: '1', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '1', attempt: 1, revision: 'a', kind: 'ci', status: 'passed', name: 'auth', policyArtifactIds: ['policy'], gateArtifactIds: ['gate'], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
      { id: '2', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '2', attempt: 1, revision: 'b', kind: 'ci', status: 'failed', name: 'auth', policyArtifactIds: ['policy', 'policy-other'], gateArtifactIds: ['gate', 'gate-other'], gateEvaluations: [{ policyArtifactId: 'policy', gateArtifactId: 'gate', status: 'failed' }], thresholds: [], evidenceLinks: [], completedAt: '2026-01-02T00:00:00.000Z' },
      { id: '3', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '3', attempt: 1, revision: 'c', kind: 'ci', status: 'passed', name: 'unlinked', policyArtifactIds: [], gateArtifactIds: ['gate'], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
      { id: '4', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: '4', attempt: 1, revision: 'd', kind: 'ci', status: 'running', name: 'auth', policyArtifactIds: ['policy'], gateArtifactIds: ['gate'], gateEvaluations: [{ policyArtifactId: 'policy', gateArtifactId: 'gate', status: 'running' }], thresholds: [], evidenceLinks: [] },
    ], [
      { id: 'policy', repositoryId: 'repo', kind: 'policy', title: 'Authentication policy', sourcePath: 'governance/auth.md', summary: 'Require authentication', evidence: [] },
      { id: 'gate', repositoryId: 'repo', kind: 'gate', title: 'Authentication gate', sourcePath: '.github/workflows/auth.yml', summary: 'Enforce authentication', evidence: [] },
    ])
    expect(rows).toEqual([{ repositoryId: 'repo', policyArtifactId: 'policy', policyTitle: 'Authentication policy', policySourcePath: 'governance/auth.md', gateArtifactId: 'gate', gateTitle: 'Authentication gate', gateSourcePath: '.github/workflows/auth.yml', revisions: ['a', 'b', 'd'], total: 3, passed: 1, failed: 1, cancelled: 0, running: 1, passRate: 0.5, latestCompletedAt: '2026-01-02T00:00:00.000Z' }])
    expect(filterTestExecutions([
      { id: 'explicit', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: 'explicit', attempt: 1, revision: 'a', kind: 'ci', status: 'failed', name: 'auth', policyArtifactIds: ['policy', 'policy-other'], gateArtifactIds: ['gate', 'gate-other'], gateEvaluations: [{ policyArtifactId: 'policy', gateArtifactId: 'gate', status: 'failed' }], thresholds: [], evidenceLinks: [] },
    ], { policyArtifactId: 'policy', gateArtifactId: 'gate-other' })).toEqual([])
    expect(filterTestExecutions([
      { id: 'legacy', repositoryId: 'repo', tenantId: 'org', provider: 'external', externalRunId: 'legacy', attempt: 1, revision: 'a', kind: 'ci', status: 'passed', name: 'auth', policyArtifactIds: ['policy'], gateArtifactIds: ['gate'], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
    ], { policyArtifactId: 'policy', gateArtifactId: 'gate' })).toHaveLength(1)
    const mixed = { id: 'mixed', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'mixed', attempt: 1, revision: 'e', kind: 'ci' as const, status: 'passed' as const, name: 'mixed gates', policyArtifactIds: ['policy', 'policy-other'], gateArtifactIds: ['gate', 'gate-other'], gateEvaluations: [{ policyArtifactId: 'policy', gateArtifactId: 'gate', status: 'passed' as const }, { policyArtifactId: 'policy-other', gateArtifactId: 'gate-other', status: 'failed' as const }], thresholds: [], evidenceLinks: [] }
    expect(filterTestExecutions([mixed], { gateOutcome: 'failed' })).toEqual([mixed])
    expect(filterTestExecutions([mixed], {
      policyArtifactId: 'policy', gateArtifactId: 'gate', gateOutcome: 'failed',
    })).toEqual([])
    expect(filterTestExecutions([mixed], {
      policyArtifactId: 'policy-other', gateArtifactId: 'gate-other', gateOutcome: 'failed',
    })).toEqual([mixed])
    expect(executionPerformance([mixed], [], 'failed')).toEqual([
      { repositoryId: 'repo', policyArtifactId: 'policy-other', gateArtifactId: 'gate-other', revisions: ['e'], total: 1, passed: 0, failed: 1, cancelled: 0, running: 0, passRate: 0 },
    ])
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
      { repositoryId: 'repo-two', policyArtifactId: 'policy', gateArtifactId: 'gate', revisions: ['a'], total: 1, passed: 0, failed: 1, cancelled: 0, running: 0, passRate: 0 },
      { repositoryId: 'repo-one', policyArtifactId: 'policy', gateArtifactId: 'gate', revisions: ['a'], total: 1, passed: 1, failed: 0, cancelled: 0, running: 0, passRate: 1 },
    ])
  })

  it('selects the latest policy-gate completion by instant instead of timestamp text', () => {
    const execution = (id: string, revision: string, completedAt: string) => ({
      id, repositoryId: 'repo', tenantId: 'org', provider: 'external' as const,
      externalRunId: id, attempt: 1, revision, kind: 'ci' as const,
      status: 'passed' as const, name: 'CI', completedAt,
      policyArtifactIds: ['policy'], gateArtifactIds: ['gate'], gateEvaluations: [],
      thresholds: [], evidenceLinks: [],
    })

    const [performance] = executionPerformance([
      execution('older', 'older', '2026-10-21T04:30:00.000Z'),
      execution('newer-offset', 'newer', '2026-10-21T00:00:00-05:00'),
    ])

    expect(performance.latestCompletedAt).toBe('2026-10-21T05:00:00.000Z')
  })
})
it('filters and trends only timestamped execution evidence', () => {
  const executions = [
    { id: 'one', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'three', attempt: 1, revision: 'a', branch: 'main', kind: 'ci' as const, status: 'failed' as const, name: 'CI', startedAt: '2026-10-07T11:59:30.000Z', completedAt: '2026-10-07T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] },
    { id: 'two', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'two', attempt: 2, revision: 'b', branch: 'feature/load', kind: 'load' as const, status: 'failed' as const, name: 'Load', completedAt: '2026-10-08T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [], evidenceCollection: { status: 'unavailable' as const, checkedAt: '2026-10-08T12:01:00.000Z', errorCode: 'PROVIDER_TIMEOUT' as const } },
    { id: 'three', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'three', attempt: 2, revision: 'c', branch: 'main', kind: 'ci' as const, status: 'passed' as const, name: 'CI', startedAt: '2026-10-07T11:59:00.000Z', completedAt: '2026-10-07T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [{ metric: 'p95', observed: 640, unit: 'ms', operator: 'lte' as const, target: 500, passed: false }], evidenceLinks: [{ kind: 'video' as const, name: 'Playwright recording', url: 'https://evidence.example/post-prod.webm' }], evidenceCollection: { status: 'complete' as const, checkedAt: '2026-10-07T12:01:00.000Z' } },
  ]
  expect(filterTestExecutions(executions, { id: executions[1].id })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { kind: 'load', from: '2026-10-08T00:00:00.000Z' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { provider: 'github-actions' })).toEqual([])
  expect(filterTestExecutions(executions, { provider: 'external' })).toEqual(executions)
  expect(filterTestExecutions(executions, { externalRunId: 'three' })).toEqual([executions[0], executions[2]])
  expect(filterTestExecutions(executions, { name: 'Load' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { evidenceKind: 'video' })).toEqual([executions[2]])
  expect(filterTestExecutions(executions, { evidenceKind: 'report' })).toEqual([])
  expect(filterTestExecutions(executions, { evidenceCollectionStatus: 'complete' })).toEqual([executions[2]])
  expect(filterTestExecutions(executions, { evidenceCollectionStatus: 'unavailable' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { evidenceCollectionStatus: 'partial' })).toEqual([])
  expect(filterTestExecutions(executions, { evidenceCollectionStatus: 'not-collected' })).toEqual([executions[0]])
  expect(filterTestExecutions(executions, { evidenceCollectionErrorCode: 'PROVIDER_TIMEOUT' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { evidenceCollectionErrorCode: 'PROVIDER_UNAVAILABLE' })).toEqual([])
  expect(filterTestExecutions(executions, { evidenceRequirement: 'provider-collection-failure' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { evidenceCheckedAfter: '2026-10-08T00:00:00.000Z' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { evidenceCheckedAfter: '2026-10-09T00:00:00.000Z' })).toEqual([])
  expect(filterTestExecutions(executions, { evidenceCheckedBefore: '2026-10-08T00:00:00.000Z' })).toEqual([executions[2]])
  expect(filterTestExecutions(executions, { evidenceCheckedBefore: '2026-10-07T00:00:00.000Z' })).toEqual([])
  const postProductionWithoutVideo = {
    ...executions[0],
    id: 'post-production-without-video',
    externalRunId: 'post-production-without-video',
    kind: 'post-production' as const,
    evidenceLinks: [{ kind: 'report' as const, name: 'Playwright report', url: 'https://evidence.example/report' }],
  }
  expect(filterTestExecutions(
    [...executions, postProductionWithoutVideo],
    { evidenceRequirement: 'post-production-video-missing' },
  )).toEqual([postProductionWithoutVideo])
  const postProductionWithUnsafeLegacyVideo = {
    ...postProductionWithoutVideo,
    id: 'post-production-with-unsafe-video',
    externalRunId: 'post-production-with-unsafe-video',
    evidenceLinks: [{ kind: 'video' as const, name: 'Legacy unsafe video', url: 'javascript:alert(1)' }],
  }
  expect(filterTestExecutions(
    [...executions, postProductionWithUnsafeLegacyVideo],
    { evidenceRequirement: 'post-production-video-missing' },
  )).toEqual([postProductionWithUnsafeLegacyVideo])
  expect(filterTestExecutions(
    [postProductionWithUnsafeLegacyVideo],
    { evidenceKind: 'video' },
  )).toEqual([])
  expect(filterTestExecutions(
    [...executions, postProductionWithUnsafeLegacyVideo],
    { evidenceRequirement: 'evidence-url-invalid' },
  )).toEqual([postProductionWithUnsafeLegacyVideo])
  const githubRunWithoutProvenance = {
    ...executions[0],
    id: 'github-run-without-provenance',
    provider: 'github-actions' as const,
    externalRunId: 'github-run-without-provenance',
  }
  const githubRunWithProvenance = {
    ...githubRunWithoutProvenance,
    id: 'github-run-with-provenance',
    externalRunId: 'github-run-with-provenance',
    headRepository: 'acme/app',
    workflowPath: '.github/workflows/ci.yml',
    sourceUrl: 'https://github.com/acme/app/actions/runs/42',
  }
  const githubForkWithoutProvenance = {
    ...githubRunWithoutProvenance,
    id: 'github-fork-without-provenance',
    externalRunId: 'github-fork-without-provenance',
    headRepository: 'contributor/app',
  }
  expect(filterTestExecutions(
    [githubRunWithoutProvenance, githubRunWithProvenance, githubForkWithoutProvenance, executions[0]],
    { evidenceRequirement: 'github-run-provenance-missing', headRepository: 'acme/app' },
  )).toEqual([githubRunWithoutProvenance])
  const githubRunWithUnverifiedAttemptArtifacts = {
    ...githubRunWithProvenance,
    id: 'github-run-with-unverified-attempt-artifacts',
    externalRunId: 'github-run-with-unverified-attempt-artifacts',
    evidenceCollection: {
      status: 'partial' as const,
      checkedAt: '2026-10-08T12:01:00.000Z',
      issues: ['attempt-provenance-unverified' as const],
      unverifiedLinks: [{ kind: 'video' as const, name: 'Run recording', url: 'https://github.com/acme/app/actions/runs/42/artifacts/7' }],
    },
  }
  expect(filterTestExecutions(
    [githubRunWithProvenance, githubRunWithUnverifiedAttemptArtifacts, executions[0]],
    { evidenceRequirement: 'attempt-provenance-unverified' },
  )).toEqual([githubRunWithUnverifiedAttemptArtifacts])
  const githubRunWithUnverifiedHeadRepository = {
    ...githubRunWithProvenance,
    id: 'github-run-with-unverified-head-repository',
    externalRunId: 'github-run-with-unverified-head-repository',
    evidenceCollection: {
      status: 'partial' as const,
      checkedAt: '2026-10-08T12:02:00.000Z',
      issues: ['head-repository-unverified' as const],
    },
  }
  expect(filterTestExecutions(
    [githubRunWithProvenance, githubRunWithUnverifiedHeadRepository, executions[0]],
    { evidenceRequirement: 'head-repository-unverified' },
  )).toEqual([githubRunWithUnverifiedHeadRepository])
  const providerResultLimitedByIssue = {
    ...githubRunWithProvenance,
    id: 'provider-result-limited-by-issue',
    externalRunId: 'provider-result-limited-by-issue',
    evidenceCollection: {
      status: 'partial' as const,
      checkedAt: '2026-10-08T12:03:00.000Z',
      issues: ['provider-result-limit-exceeded' as const],
    },
  }
  const providerResultLimitedByCode = {
    ...githubRunWithProvenance,
    id: 'provider-result-limited-by-code',
    externalRunId: 'provider-result-limited-by-code',
    evidenceCollection: {
      status: 'partial' as const,
      checkedAt: '2026-10-08T12:04:00.000Z',
      errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' as const,
    },
  }
  expect(filterTestExecutions(
    [providerResultLimitedByIssue, providerResultLimitedByCode, githubRunWithProvenance],
    { evidenceRequirement: 'provider-result-limited' },
  )).toEqual([providerResultLimitedByIssue, providerResultLimitedByCode])
  expect(filterTestExecutions(executions, { evidenceRequirement: 'performance-threshold-missing' })).toEqual([executions[1]])
  const explicitPolicyGateOutcome = {
    ...executions[0],
    id: 'explicit-policy-gate-outcome',
    policyArtifactIds: ['policy-auth'],
    gateArtifactIds: ['gate-auth'],
    gateEvaluations: [{ policyArtifactId: 'policy-auth', gateArtifactId: 'gate-auth', status: 'failed' as const }],
  }
  const legacyPolicyGateOutcome = {
    ...executions[0],
    id: 'legacy-policy-gate-outcome',
    policyArtifactIds: ['policy-auth'],
    gateArtifactIds: ['gate-auth'],
  }
  const ambiguousPolicyGateInventory = {
    ...executions[0],
    id: 'ambiguous-policy-gate-inventory',
    policyArtifactIds: ['policy-auth', 'policy-session'],
    gateArtifactIds: ['gate-auth'],
  }
  expect(filterTestExecutions([
    executions[0], explicitPolicyGateOutcome, legacyPolicyGateOutcome, ambiguousPolicyGateInventory,
  ], { evidenceRequirement: 'policy-gate-outcome-missing' })).toEqual([
    executions[0], ambiguousPolicyGateInventory,
  ])
  expect(filterTestExecutions(executions, { evidenceRequirement: 'terminal-timing-missing' })).toEqual([executions[1]])
  const invertedTerminalTiming = {
    ...executions[0],
    id: 'inverted-terminal-timing',
    startedAt: '2026-10-08T12:01:00.000Z',
    completedAt: '2026-10-08T12:00:00.000Z',
  }
  expect(filterTestExecutions([
    ...executions,
    invertedTerminalTiming,
    { ...executions[1], id: 'running-without-completion', status: 'running' as const, startedAt: '2026-10-08T12:00:00.000Z', completedAt: undefined },
  ], { evidenceRequirement: 'terminal-timing-missing' })).toEqual([executions[1], invertedTerminalTiming])
  expect(filterTestExecutions(executions, { thresholdOutcome: 'failed' })).toEqual([executions[2]])
  expect(filterTestExecutions(executions, { thresholdOutcome: 'passed' })).toEqual([])
  expect(filterTestExecutions(executions, { branch: 'feature/load' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { revision: 'b' })).toEqual([executions[1]])
  expect(filterTestExecutions(executions, { workflowPath: '.github/workflows/load.yml' })).toEqual([])
  expect(filterTestExecutions([{
    ...executions[1],
    workflowPath: '.github/workflows/load.yml@refs/heads/main',
  }], { workflowPath: '.github/workflows/load.yml' })).toHaveLength(1)
  expect(filterTestExecutions(executions, { attemptScope: 'initial' })).toEqual([executions[0]])
  expect(filterTestExecutions(executions, { attemptScope: 'retry' })).toEqual([executions[1], executions[2]])
  expect(filterTestExecutions(executions, { attemptScope: 'recovered' })).toEqual([executions[2]])
  expect(filterTestExecutions(executions, { minimumDurationMs: 45_001 })).toEqual([executions[2]])
  expect(filterTestExecutions(executions, { maximumDurationMs: 30_000 })).toEqual([executions[0]])
  expect(executionOutcomeTrend(executions)).toEqual([
    { date: '2026-10-07', total: 2, passed: 1, failed: 1, cancelled: 0, running: 0, passRate: 0.5, durationSampleCount: 2, averageDurationMs: 45_000, maximumDurationMs: 60_000, retryAttemptCount: 1, successfulRetryCount: 1, recoveredRunCount: 1, evidenceCompleteCount: 1, evidencePartialCount: 0, evidenceUnavailableCount: 0, evidenceNotCollectedCount: 1, evidenceCollectionFailureCount: 0, invalidEvidenceUrlCount: 0, githubRunProvenanceMissingCount: 0, attemptProvenanceUnverifiedCount: 0, providerResultLimitedCount: 0, headRepositoryUnverifiedCount: 0, postProductionVideoMissingCount: 0, terminalTimingMissingCount: 0, gateEvaluationCount: 0, gatePassedCount: 0, gateFailedCount: 0, gateCancelledCount: 0, gateRunningCount: 0, gateUnevaluatedExecutionCount: 2, thresholdEvaluationCount: 1, thresholdPassedCount: 0, thresholdFailedCount: 1, performanceExecutionWithoutThresholdCount: 0 },
    { date: '2026-10-08', total: 1, passed: 0, failed: 1, cancelled: 0, running: 0, passRate: 0, durationSampleCount: 0, averageDurationMs: 0, maximumDurationMs: 0, retryAttemptCount: 1, successfulRetryCount: 0, recoveredRunCount: 0, evidenceCompleteCount: 0, evidencePartialCount: 0, evidenceUnavailableCount: 1, evidenceNotCollectedCount: 0, evidenceCollectionFailureCount: 1, invalidEvidenceUrlCount: 0, githubRunProvenanceMissingCount: 0, attemptProvenanceUnverifiedCount: 0, providerResultLimitedCount: 0, headRepositoryUnverifiedCount: 0, postProductionVideoMissingCount: 0, terminalTimingMissingCount: 1, gateEvaluationCount: 0, gatePassedCount: 0, gateFailedCount: 0, gateCancelledCount: 0, gateRunningCount: 0, gateUnevaluatedExecutionCount: 1, thresholdEvaluationCount: 0, thresholdPassedCount: 0, thresholdFailedCount: 0, performanceExecutionWithoutThresholdCount: 1 },
  ])
})

it('does not infer recovery from a passed retry without retained prior failure evidence', () => {
  const passedRetry = { id: 'retry', repositoryId: 'repo', tenantId: 'org', provider: 'external' as const, externalRunId: 'run', attempt: 2, revision: 'a', kind: 'ci' as const, status: 'passed' as const, name: 'CI', completedAt: '2026-10-09T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
  expect(executionOutcomeTrend([passedRetry])).toEqual([
    { date: '2026-10-09', total: 1, passed: 1, failed: 0, cancelled: 0, running: 0, passRate: 1, durationSampleCount: 0, averageDurationMs: 0, maximumDurationMs: 0, retryAttemptCount: 1, successfulRetryCount: 1, recoveredRunCount: 0, evidenceCompleteCount: 0, evidencePartialCount: 0, evidenceUnavailableCount: 0, evidenceNotCollectedCount: 1, evidenceCollectionFailureCount: 0, invalidEvidenceUrlCount: 0, githubRunProvenanceMissingCount: 0, attemptProvenanceUnverifiedCount: 0, providerResultLimitedCount: 0, headRepositoryUnverifiedCount: 0, postProductionVideoMissingCount: 0, terminalTimingMissingCount: 1, gateEvaluationCount: 0, gatePassedCount: 0, gateFailedCount: 0, gateCancelledCount: 0, gateRunningCount: 0, gateUnevaluatedExecutionCount: 1, thresholdEvaluationCount: 0, thresholdPassedCount: 0, thresholdFailedCount: 0, performanceExecutionWithoutThresholdCount: 0 },
  ])
  const failedInitial = { ...passedRetry, id: 'initial', attempt: 1, status: 'failed' as const, completedAt: '2026-10-09T11:00:00.000Z' }
  expect(executionOutcomeTrend([passedRetry], [failedInitial, passedRetry])[0].recoveredRunCount).toBe(1)
})

it('groups offset execution timestamps into the same UTC day as PostgreSQL', () => {
  const execution = (id: string, completedAt: string) => ({
    id, repositoryId: 'repo', tenantId: 'org', provider: 'external' as const,
    externalRunId: id, attempt: 1, revision: 'a', kind: 'ci' as const,
    status: 'passed' as const, name: 'CI', completedAt, policyArtifactIds: [],
    gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
  })

  expect(executionOutcomeTrend([
    execution('offset', '2026-10-20T23:30:00-02:00'),
    execution('utc', '2026-10-21T01:45:00.000Z'),
  ])).toEqual([
    expect.objectContaining({ date: '2026-10-21', total: 2, passed: 2 }),
  ])
})

it('trends actionable evidence gaps without treating running executions as missing timing', () => {
  const base = {
    repositoryId: 'repo', tenantId: 'org', provider: 'github-actions' as const,
    attempt: 1, revision: 'a', branch: 'main', headRepository: 'acme/app',
    kind: 'post-production' as const, status: 'failed' as const, name: 'Post-production',
    completedAt: '2026-10-09T12:00:00.000Z', policyArtifactIds: [], gateArtifactIds: [],
    gateEvaluations: [], thresholds: [],
  }
  const [trend] = executionOutcomeTrend([
    {
      ...base, id: 'missing', externalRunId: 'missing', workflowPath: undefined, sourceUrl: undefined,
      evidenceLinks: [{ kind: 'video' as const, name: 'Unsafe video', url: 'javascript:alert(1)' }],
      evidenceCollection: {
        status: 'partial' as const,
        checkedAt: '2026-10-09T12:01:00.000Z',
        errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' as const,
        issues: ['attempt-provenance-unverified' as const, 'head-repository-unverified' as const],
      },
    },
    {
      ...base, id: 'complete', externalRunId: 'complete', status: 'passed' as const,
      workflowPath: '.github/workflows/post-prod.yml', sourceUrl: 'https://github.com/acme/app/actions/runs/42',
      startedAt: '2026-10-09T11:59:00.000Z',
      evidenceLinks: [{ kind: 'video' as const, name: 'Recording', url: 'https://evidence.example/post-prod.webm' }],
    },
    {
      ...base, id: 'running', externalRunId: 'running', provider: 'external' as const,
      kind: 'ci' as const, status: 'running' as const, completedAt: undefined, startedAt: '2026-10-09T12:00:00.000Z',
      evidenceLinks: [],
    },
  ])
  expect(trend).toMatchObject({
    invalidEvidenceUrlCount: 1,
    githubRunProvenanceMissingCount: 1,
    attemptProvenanceUnverifiedCount: 1,
    providerResultLimitedCount: 1,
    headRepositoryUnverifiedCount: 1,
    evidencePartialCount: 1,
    evidenceCollectionFailureCount: 1,
    postProductionVideoMissingCount: 1,
    terminalTimingMissingCount: 1,
  })
})

it('trends explicit and unambiguous legacy policy-gate outcomes without inventing ambiguous pairs', () => {
  const base = {
    repositoryId: 'repo', tenantId: 'org', provider: 'external' as const,
    attempt: 1, revision: 'a', kind: 'ci' as const, name: 'CI',
    completedAt: '2026-10-10T12:00:00.000Z', thresholds: [], evidenceLinks: [],
  }
  const [trend] = executionOutcomeTrend([
    {
      ...base, id: 'explicit', externalRunId: 'explicit', status: 'failed' as const,
      policyArtifactIds: ['policy-a', 'policy-b'], gateArtifactIds: ['gate-a', 'gate-b'],
      gateEvaluations: [
        { policyArtifactId: 'policy-a', gateArtifactId: 'gate-a', status: 'passed' as const },
        { policyArtifactId: 'policy-b', gateArtifactId: 'gate-b', status: 'failed' as const },
      ],
    },
    {
      ...base, id: 'legacy', externalRunId: 'legacy', status: 'cancelled' as const,
      policyArtifactIds: ['policy-c'], gateArtifactIds: ['gate-c'], gateEvaluations: [],
    },
    {
      ...base, id: 'ambiguous', externalRunId: 'ambiguous', status: 'passed' as const,
      policyArtifactIds: ['policy-d', 'policy-e'], gateArtifactIds: ['gate-d'], gateEvaluations: [],
    },
  ])
  expect(trend).toMatchObject({
    gateEvaluationCount: 3,
    gatePassedCount: 1,
    gateFailedCount: 1,
    gateCancelledCount: 1,
    gateRunningCount: 0,
    gateUnevaluatedExecutionCount: 1,
  })
})

it('reports total samples while excluding running attempts from the terminal pass rate', () => {
  const execution = (id: string, status: 'passed' | 'failed' | 'running') => ({
    id, repositoryId: 'repo', tenantId: 'org', provider: 'external' as const,
    externalRunId: id, attempt: 1, revision: 'a', kind: 'ci' as const, status,
    name: 'CI', completedAt: '2026-10-10T12:00:00.000Z', policyArtifactIds: [],
    gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
  })
  const [trend] = executionOutcomeTrend([
    execution('passed', 'passed'),
    execution('failed', 'failed'),
    execution('running', 'running'),
  ])
  expect(trend).toMatchObject({ total: 3, passed: 1, failed: 1, running: 1, passRate: 0.5 })
})
