import { z } from 'zod'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'
import type { PolicyGateEvaluationQuery } from '@fuzequality/core'
import { historyPageQueryFields } from './history-pagination'

export const policyGateFilterSchema = z
  .object({
    kind: z
      .enum([
        'guarded-policy',
        'unguarded-policy',
        'guard-without-policy',
        'contradictory-policy',
        'ambiguous-policy',
      ])
      .optional(),
    severity: z.enum(['high', 'medium', 'low']).optional(),
    reviewStatus: z.enum(['proposed', 'accepted', 'dismissed']).optional(),
    remediationAction: z.enum(['build-gate', 'build-policy', 'disambiguate-policy', 'align-policy-gate']).optional(),
    revision: z.string().trim().min(1).max(500).optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    sourcePath: z.string().trim().min(1).max(1000).optional(),
    policyArtifactId: z.string().trim().min(1).max(500).optional(),
    gateArtifactId: z.string().trim().min(1).max(500).optional(),
    minConfidence: z.coerce.number().min(0).max(1).optional(),
    maxConfidence: z.coerce.number().min(0).max(1).optional(),
    ...historyPageQueryFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minConfidence !== undefined && value.maxConfidence !== undefined && value.minConfidence > value.maxConfidence) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxConfidence'], message: 'maxConfidence must be greater than or equal to minConfidence' })
    }
  })

export function policyGateStoreQuery(
  filter: z.infer<typeof policyGateFilterSchema>,
  after: PolicyGateEvaluationQuery['after'],
): PolicyGateEvaluationQuery {
  const { limit, cursor: _cursor, ...query } = filter
  return { ...query, after, limit: limit + 1 }
}

export function filterPolicyGateEvaluations(
  evaluations: PolicyGateEvaluation[],
  filter: z.infer<typeof policyGateFilterSchema>
) {
  const normalizedSubject = filter.subject?.toLowerCase()
  return evaluations.filter(
    evaluation =>
      (!filter.kind || evaluation.kind === filter.kind) &&
      (!filter.remediationAction || evaluation.remediationAction === filter.remediationAction) &&
      (!filter.severity || evaluation.severity === filter.severity) &&
      (!filter.reviewStatus ||
        evaluation.reviewStatus === filter.reviewStatus) &&
      (!filter.revision || evaluation.revision === filter.revision) &&
      (!normalizedSubject || evaluation.scope.subjects.some(subject => subject.toLowerCase() === normalizedSubject)) &&
      (!filter.sourcePath || evaluation.scope.sourcePaths.includes(filter.sourcePath)) &&
      (!filter.policyArtifactId || evaluation.policyArtifactIds.includes(filter.policyArtifactId)) &&
      (!filter.gateArtifactId || evaluation.gateArtifactIds.includes(filter.gateArtifactId)) &&
      (filter.minConfidence === undefined || evaluation.confidence >= filter.minConfidence) &&
      (filter.maxConfidence === undefined || evaluation.confidence <= filter.maxConfidence)
  )
}
