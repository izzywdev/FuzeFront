import { TOPICS, requirementSyncRequestedSchema, type Portfolio } from '@fuzequality/contracts'
import {
  ChromaClient,
  LiteLlmEmbeddingProvider,
  LiteLlmFlowAnalyzer,
  SemanticCandidateIndex,
  repositoryScopeForRequirement,
  suggestionsFromAnalysis,
} from '@fuzequality/core'
import { apiRequest, runConsumer } from './runtime'
import { searchJira } from './jira'

await runConsumer(
  'fuzequality-intelligence-v1',
  [TOPICS.REPOSITORY_INVENTORY_CHANGED, TOPICS.REQUIREMENT_SYNC_REQUESTED, TOPICS.ANALYSIS_REQUESTED],
  async (topic, payload, _correlationId, { heartbeat }) => {
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
    if (topic !== TOPICS.REQUIREMENT_SYNC_REQUESTED) return
    const command = requirementSyncRequestedSchema.parse(payload)
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
        sync: { sourceType: 'jira', sourceKey: command.scopeId, cursor: sync.cursor },
      }),
    })
  }
)
