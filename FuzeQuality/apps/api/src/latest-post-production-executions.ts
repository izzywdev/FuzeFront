import type { QualityArtifact } from '@fuzequality/contracts'

/** Current scanner-reviewed workflow identities; run history is queried separately. */
export function reviewedPostProductionWorkflowPaths(artifacts: QualityArtifact[]) {
  return [...new Set(artifacts.flatMap(artifact =>
    artifact.kind === 'post-production-test' &&
    artifact.sourcePath.startsWith('.github/workflows/') &&
    /\.ya?ml$/i.test(artifact.sourcePath)
      ? [artifact.sourcePath]
      : []
  ))]
}
