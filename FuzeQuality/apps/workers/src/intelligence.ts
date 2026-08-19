import { TOPICS, requirementSyncRequestedSchema, type Portfolio } from '@fuzequality/contracts'
import { LiteLlmFlowAnalyzer, suggestionsFromAnalysis } from '@fuzequality/core'
import { apiRequest, runConsumer } from './runtime'
import { searchJira } from './jira'

await runConsumer(
  'fuzequality-intelligence-v1',
  [TOPICS.REQUIREMENT_SYNC_REQUESTED, TOPICS.ANALYSIS_REQUESTED],
  async (topic, payload) => {
    if (topic !== TOPICS.REQUIREMENT_SYNC_REQUESTED) return
    const command = requirementSyncRequestedSchema.parse(payload)
    const requirements = await searchJira(command.jql)
    const portfolio = await apiRequest<Portfolio>('/api/v1/portfolio')
    const analyzer = new LiteLlmFlowAnalyzer(
      process.env.LITELLM_URL ?? 'http://litellm.fuzeinfra.svc.cluster.local:4000/v1',
      process.env.FUZEQUALITY_LLM_MODEL ?? 'quality-analysis',
      process.env.LITELLM_MASTER_KEY
    )
    const results = []
    for (const requirement of requirements) {
      const analysis = await analyzer.analyze(requirement, {
        operations: portfolio.operations,
        surfaces: portfolio.surfaces,
      })
      results.push({ requirement, suggestions: suggestionsFromAnalysis(requirement, analysis) })
    }
    await apiRequest('/api/v1/internal/intelligence/results', {
      method: 'POST',
      body: JSON.stringify({ results }),
    })
  }
)
