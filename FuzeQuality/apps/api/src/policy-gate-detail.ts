import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import type { PolicyGateEvaluationQuery } from '@fuzequality/core'

type PolicyGateDetailDependencies = {
  repository: (repositoryId: string, tenantId: string) => Promise<Repository | undefined>
  evaluations: PolicyGateEvaluationLookup
}

export type PolicyGateEvaluationLookup = (
  repositoryId: string,
  tenantId: string,
  query: PolicyGateEvaluationQuery,
) => Promise<PolicyGateEvaluation[]>

export type PolicyGateDetailResult =
  | { status: 200; evaluation: PolicyGateEvaluation }
  | { status: 404; error: 'Repository not found' | 'Policy-gate evaluation not found' }

export async function policyGateEvaluationById(
  repositoryId: string,
  tenantId: string,
  evaluationId: string,
  evaluations: PolicyGateEvaluationLookup,
): Promise<PolicyGateEvaluation | undefined> {
  const evaluation = (await evaluations(repositoryId, tenantId, {
    id: evaluationId,
    limit: 1,
  }))[0]
  return evaluation &&
    evaluation.id === evaluationId &&
    evaluation.repositoryId === repositoryId &&
    evaluation.tenantId === tenantId
    ? evaluation
    : undefined
}

/** Resolve one governance finding without crossing the caller's FuzeFront tenant boundary. */
export async function policyGateDetail(
  repositoryId: string,
  tenantId: string,
  evaluationId: string,
  dependencies: PolicyGateDetailDependencies,
): Promise<PolicyGateDetailResult> {
  if (!await dependencies.repository(repositoryId, tenantId)) {
    return { status: 404, error: 'Repository not found' }
  }
  const evaluation = await policyGateEvaluationById(
    repositoryId,
    tenantId,
    evaluationId,
    dependencies.evaluations,
  )
  return evaluation
    ? { status: 200, evaluation }
    : { status: 404, error: 'Policy-gate evaluation not found' }
}
