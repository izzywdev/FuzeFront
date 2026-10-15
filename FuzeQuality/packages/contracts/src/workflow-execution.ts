import type { QualityArtifact } from './index'

const executableTestKinds: QualityArtifact['kind'][] = [
  'integration-test',
  'post-production-test',
  'load-test',
  'stress-test',
]

export type WorkflowExecutionKind = 'stress' | 'load' | 'post-production' | 'integration'

const workflowExecutionPrecedence: ReadonlyArray<{
  artifactKind: QualityArtifact['kind']
  executionKind: WorkflowExecutionKind
}> = [
  // Performance markers are the most specific classification and must not be
  // hidden by a generic integration or post-production workflow match.
  { artifactKind: 'stress-test', executionKind: 'stress' },
  { artifactKind: 'load-test', executionKind: 'load' },
  { artifactKind: 'post-production-test', executionKind: 'post-production' },
  { artifactKind: 'integration-test', executionKind: 'integration' },
]

/** Deterministically classifies a workflow represented by multiple inventory artifacts. */
export function preferredWorkflowExecutionKind(
  artifacts: ReadonlyArray<Pick<QualityArtifact, 'kind'>>,
): WorkflowExecutionKind | undefined {
  const kinds = new Set(artifacts.map(artifact => artifact.kind))
  return workflowExecutionPrecedence.find(candidate => kinds.has(candidate.artifactKind))?.executionKind
}

export function artifactWorkflowExecutionKind(
  artifact: Pick<QualityArtifact, 'kind'>,
): WorkflowExecutionKind | undefined {
  return workflowExecutionPrecedence.find(candidate => candidate.artifactKind === artifact.kind)?.executionKind
}

/**
 * Shared API/UI eligibility contract for scanner-verified GitHub Actions
 * workflows. GitHub accepts workflow dispatch by file name only for direct
 * children of .github/workflows; nested inventory files are never runnable.
 */
export function executableWorkflowTarget(artifact: QualityArtifact): string | undefined {
  if (!executableTestKinds.includes(artifact.kind)) return undefined
  if (artifact.execution?.provider !== 'github-actions' || artifact.execution.trigger !== 'workflow_dispatch') return undefined
  if (artifact.execution.requiredInputs?.length) return undefined
  if (artifact.execution.workflowPath !== artifact.sourcePath) return undefined
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(artifact.sourcePath)) return undefined
  return artifact.sourcePath
}
