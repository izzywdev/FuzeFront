import { normalizeWorkflowPath, testExecutionInputSchema, type QualityArtifact, type TestExecution } from '@fuzequality/contracts'
import { linkExecutionArtifacts } from '@fuzequality/core'

type ThresholdInput = ReturnType<typeof testExecutionInputSchema.parse>['thresholds'][number]
type ExecutionInput = ReturnType<typeof testExecutionInputSchema.parse>

type WorkflowExecutionIdentity = Pick<
  TestExecution,
  'repositoryId' | 'revision' | 'name' | 'workflowPath'
>

/** Link a workflow run only to policy/gate evidence from its source revision. */
export async function linkExecutionToRevisionArtifacts(
  execution: WorkflowExecutionIdentity,
  tenantId: string,
  resolveCatalogRevision: (
    repositoryId: string,
    tenantId: string,
    sourceRevision: string
  ) => Promise<string | undefined>,
  loadArtifacts: (
    repositoryId: string,
    tenantId: string,
    revision: string
  ) => Promise<QualityArtifact[]>
) {
  const catalogRevision = await resolveCatalogRevision(
    execution.repositoryId,
    tenantId,
    execution.revision,
  )
  if (!catalogRevision) return { policyArtifactIds: [], gateArtifactIds: [] }
  const artifacts = await loadArtifacts(
    execution.repositoryId,
    tenantId,
    catalogRevision
  )
  const links = linkExecutionArtifacts(
    execution.name,
    artifacts,
    execution.workflowPath
  )
  const workflowPath = normalizeWorkflowPath(execution.workflowPath)
  const performanceArtifact = workflowPath
    ? artifacts.find(artifact =>
        (artifact.kind === 'load-test' || artifact.kind === 'stress-test') &&
        artifact.execution?.provider === 'github-actions' &&
        normalizeWorkflowPath(artifact.execution.workflowPath) === workflowPath
      )
    : undefined
  return {
    ...links,
    ...(performanceArtifact
      ? { kind: performanceArtifact.kind === 'stress-test' ? 'stress' as const : 'load' as const }
      : {}),
  }
}

export type ExecutionEvidencePreparation =
  | { ok: true; execution: ExecutionInput }
  | {
      ok: false
      code: 'EXECUTION_EVIDENCE_REVISION_UNANALYZED' | 'EXECUTION_EVIDENCE_REFERENCE_INVALID'
      error: string
      invalidPolicyArtifactIds?: string[]
      invalidGateArtifactIds?: string[]
    }

/**
 * Bounds producer-supplied policy/gate evidence to the catalog generated from
 * the execution's exact source revision. When the producer supplies no links,
 * scanner-reviewed workflow linkage may fill them in without guessing pairs.
 */
export async function prepareExecutionEvidence(
  execution: ExecutionInput,
  resolveCatalogRevision: (
    repositoryId: string,
    tenantId: string,
    sourceRevision: string
  ) => Promise<string | undefined>,
  loadArtifacts: (
    repositoryId: string,
    tenantId: string,
    revision: string
  ) => Promise<QualityArtifact[]>
): Promise<ExecutionEvidencePreparation> {
  const explicitPolicyArtifactIds = [...new Set([
    ...execution.policyArtifactIds,
    ...execution.gateEvaluations.map(item => item.policyArtifactId),
  ])]
  const explicitGateArtifactIds = [...new Set([
    ...execution.gateArtifactIds,
    ...execution.gateEvaluations.map(item => item.gateArtifactId),
  ])]
  const hasExplicitReferences =
    explicitPolicyArtifactIds.length > 0 || explicitGateArtifactIds.length > 0
  const catalogRevision = await resolveCatalogRevision(
    execution.repositoryId,
    execution.tenantId,
    execution.revision,
  )

  if (!catalogRevision) {
    if (!hasExplicitReferences) return { ok: true, execution }
    return {
      ok: false,
      code: 'EXECUTION_EVIDENCE_REVISION_UNANALYZED',
      error: 'Policy/gate evidence requires an analyzed catalog for the execution revision',
    }
  }

  const artifacts = await loadArtifacts(
    execution.repositoryId,
    execution.tenantId,
    catalogRevision,
  )
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]))
  const invalidPolicyArtifactIds = explicitPolicyArtifactIds.filter(
    id => artifactsById.get(id)?.kind !== 'policy'
  )
  const invalidGateArtifactIds = explicitGateArtifactIds.filter(
    id => artifactsById.get(id)?.kind !== 'gate'
  )
  if (invalidPolicyArtifactIds.length || invalidGateArtifactIds.length) {
    return {
      ok: false,
      code: 'EXECUTION_EVIDENCE_REFERENCE_INVALID',
      error: 'Policy/gate evidence does not belong to the execution revision',
      ...(invalidPolicyArtifactIds.length ? { invalidPolicyArtifactIds } : {}),
      ...(invalidGateArtifactIds.length ? { invalidGateArtifactIds } : {}),
    }
  }

  if (hasExplicitReferences) return { ok: true, execution }

  const links = linkExecutionArtifacts(
    execution.name,
    artifacts,
    execution.workflowPath,
  )
  const gateEvaluations =
    links.policyArtifactIds.length === 1 && links.gateArtifactIds.length === 1
      ? [{
          policyArtifactId: links.policyArtifactIds[0],
          gateArtifactId: links.gateArtifactIds[0],
          status: execution.status,
        }]
      : []
  return {
    ok: true,
    execution: { ...execution, ...links, gateEvaluations },
  }
}

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
  execution: ExecutionInput,
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
