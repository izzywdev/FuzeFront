import { TOPICS, requirementSyncRequestedSchema, type Portfolio, type QualityArtifact, type Repository } from '@fuzequality/contracts'
import {
  ChromaClient,
  LiteLlmEmbeddingProvider,
  LiteLlmFlowAnalyzer,
  LiteLlmRepositoryFlowAnalyzer,
  SemanticCandidateIndex,
  repositoryScopeForRequirement,
  suggestionsFromAnalysis,
} from '@fuzequality/core'
import { apiRequest, failureCode, runConsumer } from './runtime'
import { searchJira } from './jira'
import { runRepositoryInventoryAnalysis } from './repository-analysis'

await runConsumer(
  'fuzequality-intelligence-v1',
  [TOPICS.REPOSITORY_INVENTORY_CHANGED, TOPICS.REQUIREMENT_SYNC_REQUESTED, TOPICS.ANALYSIS_REQUESTED],
  async (topic, payload, _correlationId, { heartbeat }) => {
    const command = topic === TOPICS.REQUIREMENT_SYNC_REQUESTED ? requirementSyncRequestedSchema.parse(payload) : undefined
    try {
    // Repository analysis does not need retrieval. Keep it independent of
    // Chroma so a semantic-index outage cannot suppress persisted flow and
    // governance evidence for a newly scanned revision.
    if (!command && topic === TOPICS.REPOSITORY_INVENTORY_CHANGED) {
      const inventory = payload as { repositoryId: string; revision: string }
      const repository = await apiRequest<Repository>(`/api/v1/internal/repositories/${inventory.repositoryId}`)
      const artifacts = await apiRequest<QualityArtifact[]>(`/api/v1/internal/repositories/${inventory.repositoryId}/quality-artifacts`)
      const analyzer = new LiteLlmRepositoryFlowAnalyzer(process.env.LITELLM_URL ?? 'http://litellm.fuzeinfra.svc.cluster.local:4000/v1', process.env.FUZEQUALITY_LLM_MODEL ?? 'quality-analysis', process.env.LITELLM_MASTER_KEY)
      await runRepositoryInventoryAnalysis(repository, inventory.revision, artifacts, {
        analyzer,
        persistCandidates: candidates => apiRequest('/api/v1/internal/repository-flow-candidates', { method: 'POST', body: JSON.stringify({ candidates }) }),
        persistEvaluations: evaluations => apiRequest('/api/v1/internal/policy-gate-evaluations', { method: 'POST', body: JSON.stringify({ evaluations }) }),
      })
      return
    }
    const portfolio = await apiRequest<Portfolio>('/api/v1/portfolio')
    const embeddingModel = process.env.FUZEQUALITY_EMBEDDING_MODEL ?? 'text-embedding-3-small'
    const index = new SemanticCandidateIndex(
      ChromaClient.fromEnv(),
      new LiteLlmEmbeddingProvider(
        process.env.LITELLM_URL ?? 'http://litellm.fuzeinfra.svc.cluster.local:4000/v1',
        embeddingModel,
        process.env.LITELLM_MASTER_KEY,
      ),
      'fuzequality_candidates_v1',
      embeddingModel,
    )
    const startedAt = Date.now()
    const semantic = await index.rebuild(portfolio, heartbeat)
    console.info(JSON.stringify({
      event: 'semantic_candidate_index_rebuilt',
      fingerprint: semantic.fingerprint,
      collection: semantic.collection.name,
      candidates: semantic.candidates.length,
      durationMs: Date.now() - startedAt,
    }))
    if (!command) return
    const sync = await searchJira(command.jql, { since: command.since })
    const analyzer = new LiteLlmFlowAnalyzer(
      process.env.LITELLM_URL ?? 'http://litellm.fuzeinfra.svc.cluster.local:4000/v1',
      process.env.FUZEQUALITY_LLM_MODEL ?? 'quality-analysis',
      process.env.LITELLM_MASTER_KEY
    )
    const results = []
    for (const requirement of sync.requirements) {
      const repositoryIds = repositoryScopeForRequirement(portfolio, requirement)
      const matches = await index.retrieve(
        semantic.collection,
        [requirement.summary, requirement.description, ...(requirement.acceptanceCriteria?.map(item => item.text) ?? [])].join('\n'),
        semantic.candidates,
        {
          topK: 40,
          ...(repositoryIds.length ? { repositoryIds } : {}),
          types: ['api-operation', 'frontend-surface'],
        },
      )
      const candidateIds = new Set(matches.map(match => match.id))
      const analysis = await analyzer.analyze(requirement, {
        operations: portfolio.operations.filter(item => candidateIds.has(item.id)),
        surfaces: portfolio.surfaces.filter(item => candidateIds.has(item.id)),
      })
      results.push({ requirement, suggestions: suggestionsFromAnalysis(requirement, analysis) })
      await heartbeat()
    }
    await apiRequest('/api/v1/internal/intelligence/results', {
      method: 'POST',
      body: JSON.stringify({
        results,
        sync: { sourceType: 'jira', sourceKey: command.scopeId, cursor: sync.cursor, tenantId: command.tenantId },
      }),
    })
    } catch (error) {
      if (command) {
        await apiRequest('/api/v1/internal/intelligence/failure', {
          method: 'POST',
          body: JSON.stringify({ sourceType: 'jira', sourceKey: command.scopeId, code: failureCode(error) }),
        }).catch(() => undefined)
      }
      throw error
    }
  }
)
