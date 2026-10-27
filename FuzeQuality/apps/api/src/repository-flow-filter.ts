import { z } from 'zod'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { historyPageQueryFields } from './history-pagination'

export const repositoryFlowFilterSchema = z.object({
  source: z.enum(['deterministic', 'litellm']).optional(),
  status: z.enum(['proposed', 'confirmed', 'rejected']).optional(),
  revision: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  promptVersion: z.string().trim().min(1).max(100).optional(),
  schemaVersion: z.string().trim().min(1).max(100).optional(),
  analysisRisk: z.enum(['grounding-gaps', 'prompt-truncated', 'provenance-missing']).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  ...historyPageQueryFields,
}).strict().superRefine((value, context) => {
  if (value.minConfidence !== undefined && value.maxConfidence !== undefined && value.minConfidence > value.maxConfidence) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxConfidence'], message: 'maxConfidence must be greater than or equal to minConfidence' })
  }
})

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
    (!filter.schemaVersion || candidate.analysis?.schemaVersion === filter.schemaVersion) &&
    (!filter.analysisRisk || (
      filter.analysisRisk === 'grounding-gaps'
        ? candidate.source === 'litellm' && Boolean(candidate.analysis?.grounding && (
            candidate.analysis.grounding.rejectedArtifactCount > 0 ||
            candidate.analysis.grounding.ungroundedStepCount > 0
          ))
        : filter.analysisRisk === 'prompt-truncated'
          ? candidate.source === 'litellm' && candidate.analysis?.promptTruncated === true
          : candidate.source === 'litellm' && !candidate.analysis
    )) &&
    (filter.minConfidence === undefined || candidate.confidence >= filter.minConfidence) &&
    (filter.maxConfidence === undefined || candidate.confidence <= filter.maxConfidence)
  )
}
