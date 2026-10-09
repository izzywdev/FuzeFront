import { z } from 'zod'
import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

const analysisSchema = z.object({
  provider: z.literal('fuzeinfra-litellm'),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(100),
  schemaVersion: z.string().trim().min(1).max(100),
}).strict()

const stepSchema = z.object({
  actor: z.string().trim().min(1).max(500),
  action: z.string().trim().min(1).max(2000),
  expectedOutcome: z.string().trim().min(1).max(2000),
  targetIds: z.array(z.string().trim().min(1).max(500)).max(30),
}).strict()

const repositoryFlowCandidateSchema = z.object({
  id: z.string().trim().min(1).max(200),
  repositoryId: z.string().uuid(),
  tenantId: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(200),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().trim().min(1).max(1000)).max(100),
  steps: z.array(stepSchema).min(1).max(20),
  wireframe: z.object({
    kind: z.literal('sequence'),
    nodes: z.array(z.object({
      label: z.string().trim().min(1).max(2000),
      targetIds: z.array(z.string().trim().min(1).max(500)).max(30),
    }).strict()).min(1).max(20),
  }).strict(),
  status: z.literal('proposed'),
  source: z.enum(['deterministic', 'litellm']),
  analysis: analysisSchema.optional(),
  createdAt: z.string().datetime(),
}).strict().superRefine((candidate, context) => {
  if (candidate.source === 'litellm' && !candidate.analysis) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['analysis'], message: 'LiteLLM candidates require analysis provenance' })
  }
  if (candidate.source === 'deterministic' && candidate.analysis) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['analysis'], message: 'Deterministic candidates cannot carry model provenance' })
  }
  if (candidate.source === 'litellm' && candidate.evidence.length === 0 && candidate.steps.every(step => step.targetIds.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: 'LiteLLM candidates require grounded evidence or target IDs' })
  }
})

export const repositoryFlowCandidateIngestionSchema = z.object({
  candidates: z.array(repositoryFlowCandidateSchema).max(60),
}).strict()

export async function candidateOwnershipError(
  candidates: RepositoryFlowCandidate[],
  repositoryLookup: (id: string) => Promise<Pick<Repository, 'id' | 'tenantId'> | undefined>,
) {
  const repositories = new Map<string, Pick<Repository, 'id' | 'tenantId'> | undefined>()
  for (const candidate of candidates) {
    if (!repositories.has(candidate.repositoryId)) repositories.set(candidate.repositoryId, await repositoryLookup(candidate.repositoryId))
    const repository = repositories.get(candidate.repositoryId)
    if (!repository || (repository.tenantId ?? 'legacy') !== candidate.tenantId) {
      return { candidateId: candidate.id, repositoryId: candidate.repositoryId }
    }
  }
  return undefined
}
