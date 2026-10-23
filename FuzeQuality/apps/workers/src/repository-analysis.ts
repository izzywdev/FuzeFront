import { TOPICS, type PolicyGateEvaluation, type QualityArtifact, type Repository, type RepositoryAnalysisStatus, type RepositoryFlowCandidate } from '@fuzequality/contracts'
import { deterministicRepositoryFlows, evaluatePolicyGates, RepositoryFlowAnalysisTimeoutError, type LiteLlmRepositoryFlowAnalyzer } from '@fuzequality/core'
import { z } from 'zod'

export const POLICY_GATE_EVALUATION_BATCH_SIZE = 200

const repositoryAnalysisCommandSchema = z.object({
  repositoryId: z.string().trim().min(1).max(500),
  revision: z.string().trim().min(1).max(500),
}).strict()

export function isRepositoryAnalysisTopic(topic: string) {
  return topic === TOPICS.REPOSITORY_INVENTORY_CHANGED || topic === TOPICS.ANALYSIS_REQUESTED
}

export function repositoryAnalysisFailureCode(error: unknown): NonNullable<RepositoryAnalysisStatus['errorCode']> {
  return error instanceof RepositoryFlowAnalysisTimeoutError
    ? 'INTELLIGENCE_TIMEOUT'
    : 'INTELLIGENCE_UNAVAILABLE'
}

/**
 * Catalog/revision lookup can fail before the tracked analyzer has written its
 * first `running` state. Once Kafka has exhausted the bounded delivery retries,
 * persist a safe terminal state so the portal stops polling and exposes its
 * existing reviewed-analysis retry action instead of showing `queued` forever.
 */
export async function reportExhaustedRepositoryAnalysis(
  topic: string,
  payload: unknown,
  error: unknown,
  dependencies: {
    persistStatus: (repositoryId: string, status: RepositoryAnalysisStatus) => Promise<void>
    now?: () => string
  },
) {
  if (!isRepositoryAnalysisTopic(topic)) return false
  const command = repositoryAnalysisCommandSchema.safeParse(payload)
  if (!command.success) return false
  await dependencies.persistStatus(command.data.repositoryId, {
    revision: command.data.revision,
    status: 'failed',
    finishedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    errorCode: repositoryAnalysisFailureCode(error),
  })
  return true
}

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

export async function withAnalysisHeartbeat<T>(
  operation: () => Promise<T>,
  heartbeat?: () => Promise<void>,
  intervalMs = 3_000,
) {
  if (!heartbeat) return operation()
  const beat = () => {
    void heartbeat().catch(() => undefined)
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  try {
    return await operation()
  } finally {
    clearInterval(timer)
  }
}

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

export async function runTrackedRepositoryInventoryAnalysis(
  repository: Repository,
  revision: string,
  artifacts: QualityArtifact[],
  dependencies: Parameters<typeof runRepositoryInventoryAnalysis>[3] & {
    persistStatus: (status: RepositoryAnalysisStatus) => Promise<void>
    heartbeat?: () => Promise<void>
    heartbeatIntervalMs?: number
    now?: () => string
  },
) {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const startedAt = now()
  await dependencies.persistStatus({ revision, status: 'running', startedAt })
  try {
    const counts = await withAnalysisHeartbeat(
      () => runRepositoryInventoryAnalysis(repository, revision, artifacts, dependencies),
      dependencies.heartbeat,
      dependencies.heartbeatIntervalMs,
    )
    await dependencies.persistStatus({ revision, status: 'complete', startedAt, finishedAt: now(), counts })
    return counts
  } catch (error) {
    const errorCode = repositoryAnalysisFailureCode(error)
    await dependencies.persistStatus({ revision, status: 'failed', startedAt, finishedAt: now(), errorCode }).catch(() => undefined)
    throw error
  }
}
