import { describe, expect, it, vi } from 'vitest'
import { TOPICS, type SyncCursor } from '@fuzequality/contracts'
import { queueRequirementSync } from './requirement-sync'

describe('tenant-scoped requirement synchronization', () => {
  it('publishes and queues each tenant with only its own incremental cursor', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    const markQueued = vi.fn(async (tenantId: string): Promise<SyncCursor> => ({
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'queued',
      cursor: tenantId === 'tenant-a' ? '2026-09-10T03:00:00.000Z' : undefined,
    }))

    const result = await queueRequirementSync(
      ['tenant-a', 'tenant-b'],
      'default',
      'project = FUZE',
      {
        syncCursor: async tenantId => tenantId === 'tenant-a' ? {
          sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'fresh', cursor: '2026-09-10T03:00:00.000Z',
        } : undefined,
        publish,
        markQueued,
      },
    )

    expect(publish).toHaveBeenNthCalledWith(1, TOPICS.REQUIREMENT_SYNC_REQUESTED, {
      tenantId: 'tenant-a', scopeId: 'default', jql: 'project = FUZE', since: '2026-09-10T03:00:00.000Z',
    })
    expect(publish).toHaveBeenNthCalledWith(2, TOPICS.REQUIREMENT_SYNC_REQUESTED, {
      tenantId: 'tenant-b', scopeId: 'default', jql: 'project = FUZE',
    })
    expect(markQueued.mock.calls).toEqual([['tenant-a'], ['tenant-b']])
    expect(result.map(item => item.tenantId)).toEqual(['tenant-a', 'tenant-b'])
  })

  it('does not mark a tenant queued when event publication fails', async () => {
    const markQueued = vi.fn()

    await expect(queueRequirementSync(['tenant-a'], 'default', 'project = FUZE', {
      syncCursor: async () => undefined,
      publish: async () => { throw new Error('broker unavailable') },
      markQueued,
    })).rejects.toThrow('broker unavailable')

    expect(markQueued).not.toHaveBeenCalled()
  })
})
