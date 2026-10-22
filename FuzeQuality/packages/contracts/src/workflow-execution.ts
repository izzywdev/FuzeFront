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
 * A scanner can legitimately emit more than one suite artifact for the same
 * workflow when the workflow carries overlapping reviewed markers. Only the
 * preferred classification may be dispatched: webhook ingestion applies the
 * same precedence, so dispatching a lower-priority alias would create a run
 * that can never be correlated back to the suite the operator selected.
 */
export function isPreferredWorkflowExecutionArtifact(
  artifact: Pick<QualityArtifact, 'repositoryId' | 'sourcePath' | 'kind'>,
  artifacts: ReadonlyArray<Pick<QualityArtifact, 'repositoryId' | 'sourcePath' | 'kind'>>,
): boolean {
  const artifactKind = artifactWorkflowExecutionKind(artifact)
  if (!artifactKind) return false
  const sharedWorkflowArtifacts = artifacts.filter(candidate =>
    candidate.repositoryId === artifact.repositoryId &&
    candidate.sourcePath === artifact.sourcePath &&
    artifactWorkflowExecutionKind(candidate) !== undefined
  )
  return preferredWorkflowExecutionKind(sharedWorkflowArtifacts) === artifactKind
}

/**
 * Shared API/UI eligibility contract for scanner-verified GitHub Actions
 * workflows. GitHub accepts workflow dispatch by file name only for direct
 * children of .github/workflows; nested inventory files are never runnable.
 */
export function executableWorkflowTarget(artifact: QualityArtifact): string | undefined {
  if (!executableTestKinds.includes(artifact.kind)) return undefined
  if (artifact.execution?.provider !== 'github-actions' || artifact.execution.trigger !== 'workflow_dispatch') return undefined
  if (artifact.execution.workflowPath !== artifact.sourcePath) return undefined
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(artifact.sourcePath)) return undefined
  return artifact.sourcePath
}

export type WorkflowDispatchInputValidation =
  | { success: true; inputs: Record<string, string> }
  | { success: false; missing: string[]; unexpected: string[] }

/** Bind values to the exact required input names found in the analyzed workflow. */
export function validateWorkflowDispatchInputs(
  artifact: Pick<QualityArtifact, 'execution'>,
  supplied: Readonly<Record<string, string>>,
): WorkflowDispatchInputValidation {
  const required = [...new Set(artifact.execution?.requiredInputs ?? [])].sort()
  const suppliedNames = Object.keys(supplied).sort()
  const missing = required.filter(name => !supplied[name]?.trim())
  const unexpected = suppliedNames.filter(name => !required.includes(name))
  if (missing.length || unexpected.length) return { success: false, missing, unexpected }
  return {
    success: true,
    inputs: Object.fromEntries(required.map(name => [name, supplied[name].trim()])),
  }
}
