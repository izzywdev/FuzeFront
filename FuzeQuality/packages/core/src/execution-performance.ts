import type { QualityArtifact, TestExecution } from '@fuzequality/contracts'

/** Returns only scanner-verified, manually dispatchable performance workflows. */
export function performanceWorkflowTarget(artifact: QualityArtifact): string | undefined {
  if (!['load-test', 'stress-test'].includes(artifact.kind)) return undefined
  if (artifact.execution?.provider !== 'github-actions' || artifact.execution.trigger !== 'workflow_dispatch') return undefined
  if (artifact.execution.workflowPath !== artifact.sourcePath) return undefined
  if (!artifact.sourcePath.startsWith('.github/workflows/') || !/\.ya?ml$/i.test(artifact.sourcePath)) return undefined
  return artifact.sourcePath
}

export type PolicyGatePerformance = {
  repositoryId: string
  policyArtifactId: string
  policyTitle?: string
  policySourcePath?: string
  gateArtifactId: string
  gateTitle?: string
  gateSourcePath?: string
  passed: number
  failed: number
  cancelled: number
  running: number
  latestCompletedAt?: string
}

export type ExecutionFilter = Partial<Pick<TestExecution, 'kind' | 'status' | 'provider'>> & { from?: string; until?: string }

/** Filters only the caller's already tenant-scoped execution evidence. */
export function filterTestExecutions(executions: TestExecution[], filter: ExecutionFilter = {}) {
  const from = filter.from ? Date.parse(filter.from) : undefined
  const until = filter.until ? Date.parse(filter.until) : undefined
  return executions.filter(execution => {
    if (filter.kind && execution.kind !== filter.kind) return false
    if (filter.status && execution.status !== filter.status) return false
    if (filter.provider && execution.provider !== filter.provider) return false
    const occurredAt = Date.parse(execution.completedAt ?? execution.startedAt ?? '')
    if (from !== undefined && (!Number.isFinite(occurredAt) || occurredAt < from)) return false
    if (until !== undefined && (!Number.isFinite(occurredAt) || occurredAt > until)) return false
    return true
  })
}

export type ExecutionOutcomeTrend = { date: string; passed: number; failed: number; cancelled: number; running: number }

/** Produces an evidence-only daily outcome series; missing days are not invented. */
export function executionOutcomeTrend(executions: TestExecution[]): ExecutionOutcomeTrend[] {
  const results = new Map<string, ExecutionOutcomeTrend>()
  for (const execution of executions) {
    const timestamp = execution.completedAt ?? execution.startedAt
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) continue
    const date = timestamp.slice(0, 10)
    const current = results.get(date) ?? { date, passed: 0, failed: 0, cancelled: 0, running: 0 }
    current[execution.status]++
    results.set(date, current)
  }
  return [...results.values()].sort((left, right) => left.date.localeCompare(right.date))
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
        passed: 0,
        failed: 0,
        cancelled: 0,
        running: 0,
      }
      current[evaluation.status]++
      if (execution.completedAt && (!current.latestCompletedAt || execution.completedAt > current.latestCompletedAt)) current.latestCompletedAt = execution.completedAt
      results.set(key, current)
    }
  }
  return [...results.values()].sort((left, right) => right.failed - left.failed || right.passed - left.passed || left.gateArtifactId.localeCompare(right.gateArtifactId))
}
