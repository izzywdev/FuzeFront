import type { RepositoryFlowCandidate } from './index'

/** Require the complete model identity retained for a reviewable FuzeInfra LiteLLM proposal. */
export function repositoryFlowHasCompleteAnalysisProvenance(candidate: RepositoryFlowCandidate) {
  if (candidate.source !== 'litellm') return true
  const analysis = candidate.analysis
  return Boolean(
    analysis &&
    analysis.provider === 'fuzeinfra-litellm' &&
    typeof analysis.model === 'string' && analysis.model.trim() &&
    typeof analysis.promptVersion === 'string' && analysis.promptVersion.trim() &&
    typeof analysis.schemaVersion === 'string' && analysis.schemaVersion.trim()
  )
}

/** Derive bounded-prompt risk from exact provenance while retaining the legacy aggregate flag. */
export function repositoryFlowHasBoundedPromptEvidence(candidate: RepositoryFlowCandidate) {
  const analysis = candidate.analysis
  return candidate.source === 'litellm' && Boolean(analysis && (
    analysis.promptTruncated === true ||
    (analysis.promptOmittedArtifactCount ?? 0) > 0 ||
    analysis.promptContentTruncated === true ||
    (analysis.inputArtifactCount !== undefined && analysis.promptArtifactCount !== undefined && analysis.promptArtifactCount < analysis.inputArtifactCount)
  ))
}
