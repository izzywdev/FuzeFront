import type { QualityArtifact, Repository, TestExecution } from '@fuzequality/contracts'

const executableTestKinds: QualityArtifact['kind'][] = [
  'integration-test',
  'post-production-test',
  'load-test',
  'stress-test',
]

/** Returns only scanner-verified, manually dispatchable test workflows. */
export function executableWorkflowTarget(artifact: QualityArtifact): string | undefined {
  if (!executableTestKinds.includes(artifact.kind)) return undefined
  if (artifact.execution?.provider !== 'github-actions' || artifact.execution.trigger !== 'workflow_dispatch') return undefined
  if (artifact.execution.requiredInputs?.length) return undefined
  if (artifact.execution.workflowPath !== artifact.sourcePath) return undefined
  if (!artifact.sourcePath.startsWith('.github/workflows/') || !/\.ya?ml$/i.test(artifact.sourcePath)) return undefined
  return artifact.sourcePath
}

/** Backward-compatible performance-only guard for the original API route. */
export function performanceWorkflowTarget(artifact: QualityArtifact): string | undefined {
  if (!['load-test', 'stress-test'].includes(artifact.kind)) return undefined
  return executableWorkflowTarget(artifact)
}

/** Returns the immutable source commit that produced the current reviewed catalog. */
export function testSuiteDispatchRevision(repository: Repository): string | undefined {
  const details = repository.lastScanDetails
  if (!repository.lastScanRevision || details?.catalogRevision !== repository.lastScanRevision) return undefined
  const revision = details.sourceRevision
  return revision && /^[0-9a-f]{40}$/i.test(revision) ? revision : undefined
}

/** @deprecated Use testSuiteDispatchRevision for new test-suite dispatch paths. */
export const performanceDispatchRevision = testSuiteDispatchRevision

export type PolicyGatePerformance = {
  repositoryId: string
  policyArtifactId: string
  policyTitle?: string
  policySourcePath?: string
  gateArtifactId: string
  gateTitle?: string
  gateSourcePath?: string
  /** Source commits represented by this aggregate; omitted by legacy APIs. */
  revisions?: string[]
  revisionCount?: number
  latestRevision?: string
  passed: number
  failed: number
  cancelled: number
  running: number
  latestCompletedAt?: string
}

export type PolicyGatePerformancePage = {
  items: PolicyGatePerformance[]
  page: { nextCursor: string | null; hasMore: boolean }
}

export type ExecutionFilter = Partial<Pick<TestExecution, 'kind' | 'status' | 'provider' | 'revision' | 'workflowPath'>> & {
  attemptScope?: 'initial' | 'retry' | 'recovered'
  minimumDurationMs?: number
  maximumDurationMs?: number
  from?: string
  until?: string
}

/** Requires retained failed-attempt evidence; a successful rerun alone is not recovery evidence. */
export function isRecoveredExecution(execution: TestExecution, history: TestExecution[]): boolean {
  if (execution.attempt <= 1 || execution.status !== 'passed') return false
  return history.some(previous =>
    previous.tenantId === execution.tenantId &&
    previous.repositoryId === execution.repositoryId &&
    previous.provider === execution.provider &&
    previous.externalRunId === execution.externalRunId &&
    previous.attempt < execution.attempt &&
    previous.status === 'failed'
  )
}

/** Filters only the caller's already tenant-scoped execution evidence. */
export function filterTestExecutions(executions: TestExecution[], filter: ExecutionFilter = {}, history: TestExecution[] = executions) {
  const from = filter.from ? Date.parse(filter.from) : undefined
  const until = filter.until ? Date.parse(filter.until) : undefined
  return executions.filter(execution => {
    if (filter.kind && execution.kind !== filter.kind) return false
    if (filter.status && execution.status !== filter.status) return false
    if (filter.provider && execution.provider !== filter.provider) return false
    if (filter.revision && execution.revision !== filter.revision) return false
    if (filter.workflowPath && execution.workflowPath !== filter.workflowPath) return false
    if (filter.attemptScope === 'initial' && execution.attempt !== 1) return false
    if (filter.attemptScope === 'retry' && execution.attempt <= 1) return false
    if (filter.attemptScope === 'recovered' && !isRecoveredExecution(execution, history)) return false
    if (filter.minimumDurationMs !== undefined || filter.maximumDurationMs !== undefined) {
      const startedAt = Date.parse(execution.startedAt ?? '')
      const completedAt = Date.parse(execution.completedAt ?? '')
      if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return false
      const durationMs = completedAt - startedAt
      if (filter.minimumDurationMs !== undefined && durationMs < filter.minimumDurationMs) return false
      if (filter.maximumDurationMs !== undefined && durationMs > filter.maximumDurationMs) return false
    }
    const occurredAt = Date.parse(execution.completedAt ?? execution.startedAt ?? '')
    if (from !== undefined && (!Number.isFinite(occurredAt) || occurredAt < from)) return false
    if (until !== undefined && (!Number.isFinite(occurredAt) || occurredAt > until)) return false
    return true
  })
}

export type ExecutionOutcomeTrend = {
  date: string
  passed: number
  failed: number
  cancelled: number
  running: number
  /** Runs with a valid, non-negative start/end interval. */
  durationSampleCount: number
  /** Rounded arithmetic mean for the valid intervals in this UTC-day bucket. */
  averageDurationMs: number
  /** Longest valid interval in this UTC-day bucket. */
  maximumDurationMs: number
  /** Provider attempts after the original attempt. */
  retryAttemptCount: number
  /** Retry attempts whose retained outcome is passed. */
  successfulRetryCount: number
  /** Passed retry attempts with an explicitly retained failed earlier attempt for the same provider run. */
  recoveredRunCount: number
}

/** Produces an evidence-only daily outcome series; missing days are not invented. */
export function executionOutcomeTrend(executions: TestExecution[], history: TestExecution[] = executions): ExecutionOutcomeTrend[] {
  const results = new Map<string, ExecutionOutcomeTrend & { totalDurationMs: number }>()
  const failedAttemptsByRun = new Map<string, Set<number>>()
  for (const execution of history) {
    if (execution.status !== 'failed') continue
    const runKey = [execution.tenantId, execution.repositoryId, execution.provider, execution.externalRunId].join('\u0000')
    const attempts = failedAttemptsByRun.get(runKey) ?? new Set<number>()
    attempts.add(execution.attempt)
    failedAttemptsByRun.set(runKey, attempts)
  }
  for (const execution of executions) {
    const timestamp = execution.completedAt ?? execution.startedAt
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) continue
    const date = timestamp.slice(0, 10)
    const current = results.get(date) ?? {
      date,
      passed: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
      durationSampleCount: 0,
      averageDurationMs: 0,
      maximumDurationMs: 0,
      retryAttemptCount: 0,
      successfulRetryCount: 0,
      recoveredRunCount: 0,
      totalDurationMs: 0,
    }
    current[execution.status]++
    if (execution.attempt > 1) {
      current.retryAttemptCount++
      if (execution.status === 'passed') {
        current.successfulRetryCount++
        const runKey = [execution.tenantId, execution.repositoryId, execution.provider, execution.externalRunId].join('\u0000')
        if ([...(failedAttemptsByRun.get(runKey) ?? [])].some(attempt => attempt < execution.attempt)) {
          current.recoveredRunCount++
        }
      }
    }
    const startedAt = Date.parse(execution.startedAt ?? '')
    const completedAt = Date.parse(execution.completedAt ?? '')
    if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
      current.durationSampleCount++
      const durationMs = completedAt - startedAt
      current.totalDurationMs += durationMs
      current.averageDurationMs = Math.round(current.totalDurationMs / current.durationSampleCount)
      current.maximumDurationMs = Math.max(current.maximumDurationMs, durationMs)
    }
    results.set(date, current)
  }
  return [...results.values()]
    .map(({ totalDurationMs: _totalDurationMs, ...trend }) => trend)
    .sort((left, right) => left.date.localeCompare(right.date))
}

/** Aggregates immutable execution evidence; no missing link is inferred as a passing gate. */
export function executionPerformance(executions: TestExecution[], artifacts: QualityArtifact[] = []): PolicyGatePerformance[] {
  const results = new Map<string, PolicyGatePerformance>()
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]))
  for (const execution of executions) {
    // Rows created before explicit pair evidence existed are only safe to use
    // when there is exactly one possible pair. Never create a Cartesian product.
    const gateEvaluations = execution.gateEvaluations.length
      ? execution.gateEvaluations
      : execution.policyArtifactIds.length === 1 && execution.gateArtifactIds.length === 1
        ? [{ policyArtifactId: execution.policyArtifactIds[0], gateArtifactId: execution.gateArtifactIds[0], status: execution.status }]
        : []
    for (const evaluation of gateEvaluations) {
      const key = `${execution.repositoryId}:${evaluation.policyArtifactId}:${evaluation.gateArtifactId}`
      const policy = artifactsById.get(evaluation.policyArtifactId)
      const gate = artifactsById.get(evaluation.gateArtifactId)
      const current = results.get(key) ?? {
        repositoryId: execution.repositoryId,
        policyArtifactId: evaluation.policyArtifactId,
        ...(policy?.kind === 'policy' ? { policyTitle: policy.title, policySourcePath: policy.sourcePath } : {}),
        gateArtifactId: evaluation.gateArtifactId,
        ...(gate?.kind === 'gate' ? { gateTitle: gate.title, gateSourcePath: gate.sourcePath } : {}),
        revisions: [],
        passed: 0,
        failed: 0,
        cancelled: 0,
        running: 0,
      }
      current.revisions ??= []
      if (!current.revisions.includes(execution.revision)) current.revisions.push(execution.revision)
      current[evaluation.status]++
      if (execution.completedAt && (!current.latestCompletedAt || execution.completedAt > current.latestCompletedAt)) current.latestCompletedAt = execution.completedAt
      results.set(key, current)
    }
  }
  return [...results.values()].sort((left, right) =>
    right.failed - left.failed ||
    right.passed - left.passed ||
    left.gateArtifactId.localeCompare(right.gateArtifactId) ||
    left.policyArtifactId.localeCompare(right.policyArtifactId)
  )
}
