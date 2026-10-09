import { z } from 'zod'
import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'

const policyGateEvaluationSchema = z.object({
  id: z.string().trim().min(1).max(200),
  repositoryId: z.string().uuid(),
  tenantId: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(500),
  kind: z.enum(['unguarded-policy', 'guard-without-policy', 'contradictory-policy', 'ambiguous-policy']),
  severity: z.enum(['high', 'medium', 'low']),
  title: z.string().trim().min(1).max(500),
  detail: z.string().trim().min(1).max(5000),
  policyArtifactIds: z.array(z.string().trim().min(1).max(500)).max(100),
  gateArtifactIds: z.array(z.string().trim().min(1).max(500)).max(100),
  confidence: z.number().min(0).max(1),
  scope: z.object({
    sourcePaths: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
    subjects: z.array(z.string().trim().min(1).max(200)).max(100),
  }).strict(),
  recommendation: z.string().trim().min(1).max(5000),
  reviewStatus: z.literal('proposed'),
  createdAt: z.string().datetime(),
}).strict()

export const policyGateEvaluationIngestionSchema = z.object({
  evaluations: z.array(policyGateEvaluationSchema).max(200),
}).strict()

export async function policyGateOwnershipError(
  evaluations: PolicyGateEvaluation[],
  repositoryLookup: (id: string) => Promise<Pick<Repository, 'id' | 'tenantId'> | undefined>,
) {
  const repositories = new Map<string, Pick<Repository, 'id' | 'tenantId'> | undefined>()
  for (const evaluation of evaluations) {
    if (!repositories.has(evaluation.repositoryId)) repositories.set(evaluation.repositoryId, await repositoryLookup(evaluation.repositoryId))
    const repository = repositories.get(evaluation.repositoryId)
    if (!repository || (repository.tenantId ?? 'legacy') !== evaluation.tenantId) {
      return { evaluationId: evaluation.id, repositoryId: evaluation.repositoryId }
    }
  }
  return undefined
}
