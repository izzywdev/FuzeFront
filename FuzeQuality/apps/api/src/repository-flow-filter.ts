import { z } from 'zod'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { repositoryFlowHasBoundedPromptEvidence, repositoryFlowHasCompleteAnalysisProvenance } from '@fuzequality/contracts/repository-flow'
import { historyPageQueryFields } from './history-pagination'

export const repositoryFlowFilterSchema = z.object({
  source: z.enum(['deterministic', 'litellm']).optional(),
  status: z.enum(['proposed', 'confirmed', 'rejected']).optional(),
  revision: z.string().trim().min(1).max(500).optional(),
  targetId: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  promptVersion: z.string().trim().min(1).max(100).optional(),
  schemaVersion: z.string().trim().min(1).max(100).optional(),
  analysisRisk: z.enum(['grounding-gaps', 'prompt-truncated', 'artifacts-omitted', 'content-truncated', 'provenance-missing', 'wireframe-missing', 'steps-missing']).optional(),
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
    (!filter.targetId || candidate.evidence.includes(filter.targetId) ||
      candidate.steps.some(step => step.targetIds.includes(filter.targetId!)) ||
      candidate.wireframe.nodes.some(node => node.targetIds.includes(filter.targetId!))) &&
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
          ? repositoryFlowHasBoundedPromptEvidence(candidate)
          : filter.analysisRisk === 'artifacts-omitted'
            ? candidate.source === 'litellm' && Boolean(candidate.analysis && (
                (candidate.analysis.promptOmittedArtifactCount ?? Math.max(
                  (candidate.analysis.inputArtifactCount ?? 0) - (candidate.analysis.promptArtifactCount ?? 0),
                  0,
                )) > 0
              ))
            : filter.analysisRisk === 'content-truncated'
              ? candidate.source === 'litellm' && candidate.analysis?.promptContentTruncated === true
              : filter.analysisRisk === 'provenance-missing'
                ? candidate.source === 'litellm' && !repositoryFlowHasCompleteAnalysisProvenance(candidate)
                : filter.analysisRisk === 'wireframe-missing'
                  ? candidate.wireframe.nodes.length === 0
                  : candidate.steps.length === 0
    )) &&
    (filter.minConfidence === undefined || candidate.confidence >= filter.minConfidence) &&
    (filter.maxConfidence === undefined || candidate.confidence <= filter.maxConfidence)
  )
}
