import type { TestExecution } from '@fuzequality/contracts'

export type PolicyGatePerformance = {
  policyArtifactId: string
  gateArtifactId: string
  passed: number
  failed: number
  cancelled: number
  running: number
  latestCompletedAt?: string
}

/** Aggregates immutable execution evidence; no missing link is inferred as a passing gate. */
export function executionPerformance(executions: TestExecution[]): PolicyGatePerformance[] {
  const results = new Map<string, PolicyGatePerformance>()
  for (const execution of executions) for (const policyArtifactId of execution.policyArtifactIds) for (const gateArtifactId of execution.gateArtifactIds) {
    const key = `${policyArtifactId}:${gateArtifactId}`
    const current = results.get(key) ?? { policyArtifactId, gateArtifactId, passed: 0, failed: 0, cancelled: 0, running: 0 }
    current[execution.status]++
    if (execution.completedAt && (!current.latestCompletedAt || execution.completedAt > current.latestCompletedAt)) current.latestCompletedAt = execution.completedAt
    results.set(key, current)
  }
  return [...results.values()].sort((left, right) => right.failed - left.failed || right.passed - left.passed || left.gateArtifactId.localeCompare(right.gateArtifactId))
}
