import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

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
