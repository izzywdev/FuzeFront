import type { QualityArtifact } from './index'

const executableTestKinds: QualityArtifact['kind'][] = [
  'integration-test',
  'post-production-test',
  'load-test',
  'stress-test',
]

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
