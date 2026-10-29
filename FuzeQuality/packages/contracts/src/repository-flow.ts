import type { RepositoryFlowCandidate } from './index'

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
