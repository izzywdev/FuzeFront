import { z } from 'zod'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'

export const policyGateFilterSchema = z
  .object({
    kind: z
      .enum([
        'unguarded-policy',
        'guard-without-policy',
        'contradictory-policy',
        'ambiguous-policy',
      ])
      .optional(),
    severity: z.enum(['high', 'medium', 'low']).optional(),
    reviewStatus: z.enum(['proposed', 'accepted', 'dismissed']).optional(),
    revision: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

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
      (!filter.revision || evaluation.revision === filter.revision)
  )
}
