import type { QualityArtifact } from '@fuzequality/contracts'

/** Current scanner-reviewed integration workflow identities; run history is queried separately. */
export function reviewedIntegrationWorkflowPaths(artifacts: QualityArtifact[]) {
  return [...new Set(artifacts.flatMap(artifact =>
    artifact.kind === 'integration-test' &&
    artifact.sourcePath.startsWith('.github/workflows/') &&
    /\.ya?ml$/i.test(artifact.sourcePath)
      ? [artifact.sourcePath]
      : []
  ))]
}
