import type { QualityArtifact, Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

export function repositoryFlowReviewConflict(
  repository: Repository,
  candidate: RepositoryFlowCandidate
) {
  if (
    repository.lastScanRevision &&
    candidate.revision === repository.lastScanRevision
  ) {
    return undefined
  }

  return {
    error:
      'This UX-flow candidate is not from the repository current analyzed revision. Refresh the analysis before reviewing it.',
    code: 'STALE_FLOW_CANDIDATE',
    candidateRevision: candidate.revision,
    currentRevision: repository.lastScanRevision ?? null,
  } as const
}

export function repositoryFlowReviewStateConflict(
  candidate: RepositoryFlowCandidate,
  expectedReviewedAt: string | null | undefined,
) {
  if (
    expectedReviewedAt === undefined ||
    (candidate.reviewedAt ?? null) === expectedReviewedAt
  ) return undefined

  return {
    error:
      'This UX-flow review changed while you were deciding. Refresh the current decision before reviewing it again.',
    code: 'STALE_FLOW_REVIEW',
    expectedReviewedAt,
    currentReviewedAt: candidate.reviewedAt ?? null,
  } as const
}

export function repositoryFlowGroundingRationaleConflict(
  candidate: RepositoryFlowCandidate,
  status: 'confirmed' | 'rejected',
  reason?: string,
) {
  const grounding = candidate.analysis?.grounding
  const hasGroundingGaps = Boolean(
    grounding &&
    (grounding.rejectedArtifactCount > 0 || grounding.ungroundedStepCount > 0)
  )
  if (status !== 'confirmed' || !hasGroundingGaps || (reason?.trim().length ?? 0) >= 3) return undefined

  return {
    error: 'A reviewer rationale is required to confirm a LiteLLM flow with unverified repository grounding.',
    code: 'FLOW_GROUNDING_RATIONALE_REQUIRED',
    grounding,
  } as const
}

export function repositoryFlowArtifactReferenceConflict(
  candidate: RepositoryFlowCandidate,
  artifacts: QualityArtifact[],
  status: 'confirmed' | 'rejected',
) {
  if (status !== 'confirmed') return undefined

  const artifactIds = new Set(artifacts.flatMap(artifact => [
    artifact.id,
    ...(artifact.logicalId ? [artifact.logicalId] : []),
  ]))
  const targetId = [...new Set([
    ...candidate.steps.flatMap(step => step.targetIds),
    ...candidate.wireframe.nodes.flatMap(node => node.targetIds),
  ])].find(id => !artifactIds.has(id))
  if (!targetId) return undefined

  return {
    error: 'This UX-flow candidate references evidence that is unavailable in its exact repository revision. Regenerate the analysis before confirming it.',
    code: 'FLOW_ARTIFACT_REFERENCE_UNAVAILABLE',
    candidateId: candidate.id,
    revision: candidate.revision,
    targetId,
  } as const
}
