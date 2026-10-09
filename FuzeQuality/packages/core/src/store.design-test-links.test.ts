import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

describe('design-test-link projection', () => {
  const link = {
    type: 'design-test-link.upsert' as const,
    tenantId: 'org_1', traceLinkId: 'trace_1', fuzexProjectId: 'project_1',
    targetKind: 'frame' as const, targetRef: 'checkout', testCaseId: 'test_1',
  }
  const outbound = { topic: 'fuzequality.design.test-link.verified', key: 'org_1:trace_1', payload: { tenantId: 'org_1' } }

  it('is idempotent and records a revocation as a distinct durable state change', async () => {
    const store = new MemoryCatalogStore()
    await expect(store.projectDesignTestLink(link, outbound)).resolves.toBe(true)
    await expect(store.projectDesignTestLink(link, outbound)).resolves.toBe(false)
    await expect(store.projectDesignTestLink({ ...link, type: 'design-test-link.removed' }, { ...outbound, topic: 'fuzequality.design.test-link.revoked' })).resolves.toBe(true)
  })
})
