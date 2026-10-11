import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import type { CatalogStore } from '@fuzequality/core'

export async function policyGateEvaluationForReview(
  store: Pick<CatalogStore, 'policyGateEvaluations'>,
  repositoryId: string,
  tenantId: string,
  evaluationId: string,
) {
  return (await store.policyGateEvaluations(repositoryId, tenantId, {
    id: evaluationId,
    limit: 1,
  }))[0]
}

export function policyGateReviewConflict(
  repository: Repository,
  evaluation: PolicyGateEvaluation
) {
  if (
    repository.lastScanRevision &&
    evaluation.revision === repository.lastScanRevision
  ) {
    return undefined
  }

  return {
    error:
      'This policy-gate finding is not from the repository current analyzed revision. Refresh the analysis before reviewing it.',
    code: 'STALE_POLICY_GATE_EVALUATION',
    evaluationRevision: evaluation.revision,
    currentRevision: repository.lastScanRevision ?? null,
  } as const
}
