import { z } from 'zod'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'
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
    revision: z.string().trim().min(1).max(500).optional(),
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

export function filterPolicyGateEvaluations(
  evaluations: PolicyGateEvaluation[],
  filter: z.infer<typeof policyGateFilterSchema>
) {
  return evaluations.filter(
    evaluation =>
      (!filter.kind || evaluation.kind === filter.kind) &&
      (!filter.severity || evaluation.severity === filter.severity) &&
      (!filter.reviewStatus ||
        evaluation.reviewStatus === filter.reviewStatus) &&
      (!filter.revision || evaluation.revision === filter.revision) &&
      (filter.minConfidence === undefined || evaluation.confidence >= filter.minConfidence) &&
      (filter.maxConfidence === undefined || evaluation.confidence <= filter.maxConfidence)
  )
}
