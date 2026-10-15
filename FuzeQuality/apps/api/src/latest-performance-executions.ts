import type { QualityArtifact } from '@fuzequality/contracts'

/** Current scanner-reviewed performance workflow identities; dispatch eligibility is separate. */
export function reviewedPerformanceWorkflowPaths(artifacts: QualityArtifact[]) {
  return [...new Set(artifacts.flatMap(artifact =>
    (artifact.kind === 'load-test' || artifact.kind === 'stress-test') &&
    artifact.sourcePath.startsWith('.github/workflows/') &&
    /\.ya?ml$/i.test(artifact.sourcePath)
      ? [artifact.sourcePath]
      : []
  ))]
}
