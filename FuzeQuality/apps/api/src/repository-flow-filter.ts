import { z } from 'zod'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'

export const repositoryFlowFilterSchema = z.object({
  source: z.enum(['deterministic', 'litellm']).optional(),
  status: z.enum(['proposed', 'confirmed', 'rejected']).optional(),
  revision: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  promptVersion: z.string().trim().min(1).max(100).optional(),
  schemaVersion: z.string().trim().min(1).max(100).optional(),
}).strict()

export function filterRepositoryFlowCandidates(
  candidates: RepositoryFlowCandidate[],
  filter: z.infer<typeof repositoryFlowFilterSchema>,
) {
  return candidates.filter(candidate =>
    (!filter.source || candidate.source === filter.source) &&
    (!filter.status || candidate.status === filter.status) &&
    (!filter.revision || candidate.revision === filter.revision) &&
    (!filter.model || candidate.analysis?.model === filter.model) &&
    (!filter.promptVersion || candidate.analysis?.promptVersion === filter.promptVersion) &&
    (!filter.schemaVersion || candidate.analysis?.schemaVersion === filter.schemaVersion)
  )
}
