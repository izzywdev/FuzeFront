import { testExecutionInputSchema, type TestExecution } from '@fuzequality/contracts'

type ThresholdInput = ReturnType<typeof testExecutionInputSchema.parse>['thresholds'][number]

export function thresholdPassed(threshold: ThresholdInput): boolean {
  switch (threshold.operator) {
    case 'lt': return threshold.observed < threshold.target
    case 'lte': return threshold.observed <= threshold.target
    case 'gt': return threshold.observed > threshold.target
    case 'gte': return threshold.observed >= threshold.target
    case 'eq': return threshold.observed === threshold.target
  }
}

/**
 * Gives legacy S2S producers a durable external identity without weakening the
 * database invariant. Callers that know their provider identity keep it;
 * callers using the older payload shape use the generated row id consistently.
 */
export function executionRecord(
  execution: ReturnType<typeof testExecutionInputSchema.parse>,
  id: string,
): TestExecution {
  const policyArtifactIds = [...new Set([
    ...execution.policyArtifactIds,
    ...execution.gateEvaluations.map(item => item.policyArtifactId),
  ])]
  const gateArtifactIds = [...new Set([
    ...execution.gateArtifactIds,
    ...execution.gateEvaluations.map(item => item.gateArtifactId),
  ])]
  return {
    id,
    ...execution,
    externalRunId: execution.externalRunId ?? id,
    policyArtifactIds,
    gateArtifactIds,
    thresholds: execution.thresholds.map(threshold => ({
      ...threshold,
      passed: thresholdPassed(threshold),
    })),
  }
}
