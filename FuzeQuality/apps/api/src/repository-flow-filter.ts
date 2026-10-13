import { z } from 'zod'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'

export const repositoryFlowFilterSchema = z.object({
  source: z.enum(['deterministic', 'litellm']).optional(),
  status: z.enum(['proposed', 'confirmed', 'rejected']).optional(),
  revision: z.string().trim().min(1).max(500).optional(),
}).strict()

export function filterRepositoryFlowCandidates(
  candidates: RepositoryFlowCandidate[],
  filter: z.infer<typeof repositoryFlowFilterSchema>,
) {
  return candidates.filter(candidate =>
    (!filter.source || candidate.source === filter.source) &&
    (!filter.status || candidate.status === filter.status) &&
    (!filter.revision || candidate.revision === filter.revision)
  )
}
