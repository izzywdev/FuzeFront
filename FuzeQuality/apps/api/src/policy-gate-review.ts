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

export function policyGateReviewStateConflict(
  evaluation: PolicyGateEvaluation,
  expectedReviewedAt: string | null | undefined,
) {
  if (
    expectedReviewedAt === undefined ||
    (evaluation.reviewedAt ?? null) === expectedReviewedAt
  ) return undefined

  return {
    error:
      'This policy/gate review changed while you were deciding. Refresh the current decision before reviewing it again.',
    code: 'STALE_POLICY_GATE_REVIEW',
    expectedReviewedAt,
    currentReviewedAt: evaluation.reviewedAt ?? null,
  } as const
}

export function policyGateReviewRationaleConflict(
  evaluation: PolicyGateEvaluation,
  status: 'accepted' | 'dismissed',
  reason?: string,
) {
  const requiresRationale = evaluation.kind !== 'guarded-policy'
  if (
    status !== 'accepted' ||
    !requiresRationale ||
    (reason?.trim().length ?? 0) >= 3
  ) return undefined

  return {
    error: 'A reviewer rationale is required to accept a policy or gate anomaly remediation.',
    code: 'POLICY_GATE_RATIONALE_REQUIRED',
    evaluationKind: evaluation.kind,
    remediationAction: evaluation.remediationAction,
  } as const
}
