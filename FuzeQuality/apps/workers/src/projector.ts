import { TOPICS } from '@fuzequality/contracts'
import { apiRequest, runConsumer } from './runtime'

await runConsumer(
  'fuzequality-projector-v1',
  [
    TOPICS.REPOSITORY_INVENTORY_CHANGED,
    TOPICS.REQUIREMENT_CHANGED,
    TOPICS.ANALYSIS_COMPLETED,
    TOPICS.MAPPING_REVIEWED,
    TOPICS.COVERAGE_REBUILD_REQUESTED,
  ],
  async () => {
    await apiRequest('/api/v1/internal/coverage/rebuild', { method: 'POST', body: '{}' })
  }
)
