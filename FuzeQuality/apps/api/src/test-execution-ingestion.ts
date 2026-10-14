import { normalizeWorkflowPath, testExecutionInputSchema, type QualityArtifact, type ScanResult, type TestExecution } from '@fuzequality/contracts'
import { linkExecutionArtifacts } from '@fuzequality/core'
import type { WorkflowExecutionCommand } from '@fuzequality/github-app'

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
  if (!catalogRevision) return { policyArtifactIds: [], gateArtifactIds: [], policyGatePairs: [] }
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
  const classifiedArtifact = workflowPath
    ? artifacts.find(artifact =>
        ['load-test', 'stress-test', 'post-production-test', 'integration-test'].includes(artifact.kind) &&
        normalizeWorkflowPath(artifact.sourcePath) === workflowPath
      )
    : undefined
  const kind = classifiedArtifact?.kind === 'stress-test'
    ? 'stress' as const
    : classifiedArtifact?.kind === 'load-test'
      ? 'load' as const
      : classifiedArtifact?.kind === 'post-production-test'
        ? 'post-production' as const
        : classifiedArtifact?.kind === 'integration-test'
          ? 'integration' as const
          : undefined
  return {
    ...links,
    ...(kind ? { kind } : {}),
  }
}

type RevisionArtifactLinks = Awaited<ReturnType<typeof linkExecutionToRevisionArtifacts>>

export function mergeExecutionEvidenceLinks(
  existing: WorkflowExecutionCommand['evidenceLinks'],
  discovered: WorkflowExecutionCommand['evidenceLinks'],
) {
  return [...new Map(
    [...existing, ...discovered].map(link => [`${link.kind}:${link.url}`, link])
  ).values()].slice(0, 100)
}

/**
 * Builds a GitHub webhook execution with exact-revision catalog evidence.
 * Catalog-derived links and performance kind are authoritative over the
 * workflow-name heuristic; all other execution identity remains provider-owned.
 */
export function webhookExecutionRecord(
  execution: WorkflowExecutionCommand,
  tenantId: string,
  links: RevisionArtifactLinks,
): TestExecution {
  const gateEvaluations = links.policyGatePairs.map(pair => ({
    ...pair,
    status: execution.status,
  }))
  return {
    ...execution,
    id: `${execution.provider}:${execution.externalRunId}:${execution.attempt}:${execution.repositoryId}`,
    tenantId,
    thresholds: [],
    policyArtifactIds: links.policyArtifactIds,
    gateArtifactIds: links.gateArtifactIds,
    gateEvaluations,
    kind: links.kind ?? execution.kind,
  }
}

/**
 * Repairs workflow evidence that arrived before its asynchronous repository
 * scan. Only the scan's exact source revision is eligible, and an existing
 * producer/catalog linkage is never replaced.
 */
export async function reconcileExecutionEvidenceForScan(
  result: ScanResult,
  tenantId: string,
  loadExecutions: (repositoryId: string, tenantId: string, revision: string) => Promise<TestExecution[]>,
  saveExecution: (execution: TestExecution) => Promise<void>,
) {
  const sourceRevision = result.scanDetails.sourceRevision
  if (!sourceRevision) return 0
  const artifacts = result.qualityArtifacts ?? []
  const executions = await loadExecutions(result.repository.id, tenantId, sourceRevision)
  let reconciled = 0
  for (const execution of executions) {
    if (execution.policyArtifactIds.length || execution.gateArtifactIds.length || execution.gateEvaluations.length) continue
    const links = await linkExecutionToRevisionArtifacts(
      execution,
      tenantId,
      async (repositoryId, candidateTenantId, candidateSourceRevision) =>
        repositoryId === result.repository.id && candidateTenantId === tenantId && candidateSourceRevision === sourceRevision
          ? result.revision
          : undefined,
      async (repositoryId, candidateTenantId, candidateCatalogRevision) =>
        repositoryId === result.repository.id && candidateTenantId === tenantId && candidateCatalogRevision === result.revision
          ? artifacts
          : [],
    )
    const kind = links.kind ?? execution.kind
    if (!links.policyArtifactIds.length && !links.gateArtifactIds.length && kind === execution.kind) continue
    await saveExecution({
      ...execution,
      kind,
      policyArtifactIds: links.policyArtifactIds,
      gateArtifactIds: links.gateArtifactIds,
      gateEvaluations: links.policyGatePairs.map(pair => ({ ...pair, status: execution.status })),
    })
    reconciled += 1
  }
  return reconciled
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
  const gateEvaluations = links.policyGatePairs.map(pair => ({
    ...pair,
    status: execution.status,
  }))
  return {
    ok: true,
    execution: {
      ...execution,
      policyArtifactIds: links.policyArtifactIds,
      gateArtifactIds: links.gateArtifactIds,
      gateEvaluations,
    },
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
