import type { PolicyGateEvaluation, QualityArtifact, Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { deterministicRepositoryFlows, evaluatePolicyGates, type LiteLlmRepositoryFlowAnalyzer } from '@fuzequality/core'

export const POLICY_GATE_EVALUATION_BATCH_SIZE = 200

function evaluationBatches(evaluations: PolicyGateEvaluation[]) {
  if (!evaluations.length) return [[]]
  const batches: PolicyGateEvaluation[][] = []
  for (let index = 0; index < evaluations.length; index += POLICY_GATE_EVALUATION_BATCH_SIZE) {
    batches.push(evaluations.slice(index, index + POLICY_GATE_EVALUATION_BATCH_SIZE))
  }
  return batches
}

export const repositoryQualityArtifactsPath = (repositoryId: string, revision: string) =>
  `/api/v1/internal/repositories/${encodeURIComponent(repositoryId)}/quality-artifacts?revision=${encodeURIComponent(revision)}`

export async function runRepositoryInventoryAnalysis(
  repository: Repository,
  revision: string,
  artifacts: QualityArtifact[],
  dependencies: {
    analyzer: Pick<LiteLlmRepositoryFlowAnalyzer, 'analyze'>
    persistCandidates: (candidates: RepositoryFlowCandidate[]) => Promise<void>
    persistEvaluations: (evaluations: PolicyGateEvaluation[]) => Promise<void>
  },
) {
  const deterministic = deterministicRepositoryFlows(repository, revision, artifacts)
  const evaluations = evaluatePolicyGates(repository, revision, artifacts)

  // Durable repository facts must survive a FuzeInfra/LiteLLM outage. Persist
  // them before making the fallible gateway call; each persistence API is
  // idempotent for the same repository revision.
  await dependencies.persistCandidates(deterministic)
  for (const batch of evaluationBatches(evaluations)) {
    await dependencies.persistEvaluations(batch)
  }

  const proposed = await dependencies.analyzer.analyze(repository, revision, artifacts)
  if (proposed.length) await dependencies.persistCandidates(proposed)
  return { deterministic: deterministic.length, evaluations: evaluations.length, proposed: proposed.length }
}
