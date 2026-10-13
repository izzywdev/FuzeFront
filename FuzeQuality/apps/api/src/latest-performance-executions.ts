import type { QualityArtifact } from '@fuzequality/contracts'

/** Only scanner-reviewed dispatch workflows from the current artifact revision may drive lookup. */
export function reviewedPerformanceWorkflowPaths(artifacts: QualityArtifact[]) {
  return [...new Set(artifacts.flatMap(artifact =>
    (artifact.kind === 'load-test' || artifact.kind === 'stress-test') &&
    artifact.execution?.provider === 'github-actions' &&
    artifact.execution.trigger === 'workflow_dispatch' &&
    artifact.execution.workflowPath === artifact.sourcePath &&
    (artifact.execution.requiredInputs?.length ?? 0) === 0
      ? [artifact.execution.workflowPath]
      : []
  ))]
}
