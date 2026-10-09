import { designTestLinkEventSchema } from '@fuzequality/contracts'
import { apiRequest, runConsumer } from './runtime'

/**
 * FuzeX is the author of design decisions. FuzeQuality consumes only
 * relationship events and verifies that a referenced test case belongs to the
 * event's organization before publishing a local, tenant-safe result.
 */
await runConsumer(
  'fuzequality-design-test-links-v1',
  ['fuzex.design.test-link.requested', 'fuzex.design.test-link.removed'],
  async (topic, payload) => {
    const event = designTestLinkEventSchema.parse(payload)
    await apiRequest('/api/v1/internal/design-test-links', {
      method: 'POST',
      body: JSON.stringify({
        ...event,
        type: topic === 'fuzex.design.test-link.requested' ? 'design-test-link.upsert' : 'design-test-link.removed',
      }),
    })
  },
)
