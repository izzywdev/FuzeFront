import { describe, expect, it, vi } from 'vitest'
import { TOPICS, type SyncCursor } from '@fuzequality/contracts'
import { activeRequirementSyncStatuses, queueRequirementSync, requirementSyncRequestSchema } from './requirement-sync'

describe('tenant-scoped requirement synchronization', () => {
  it('publishes and queues each tenant with only its own incremental cursor', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    const operations: string[] = []
    const markQueued = vi.fn(async (tenantId: string): Promise<SyncCursor> => ({
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'queued',
      cursor: tenantId === 'tenant-a' ? '2026-09-10T03:00:00.000Z' : undefined,
    })).mockImplementation(async (tenantId: string) => {
      operations.push(`queued:${tenantId}`)
      return {
        sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'queued',
        cursor: tenantId === 'tenant-a' ? '2026-09-10T03:00:00.000Z' : undefined,
      }
    })
    publish.mockImplementation(async (_topic, payload) => {
      operations.push(`published:${(payload as { tenantId: string }).tenantId}`)
    })

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
        markFailed: vi.fn(),
      },
    )

    expect(publish).toHaveBeenNthCalledWith(1, TOPICS.REQUIREMENT_SYNC_REQUESTED, {
      tenantId: 'tenant-a', scopeId: 'default', jql: 'project = FUZE', since: '2026-09-10T03:00:00.000Z',
    })
    expect(publish).toHaveBeenNthCalledWith(2, TOPICS.REQUIREMENT_SYNC_REQUESTED, {
      tenantId: 'tenant-b', scopeId: 'default', jql: 'project = FUZE',
    })
    expect(markQueued.mock.calls).toEqual([['tenant-a'], ['tenant-b']])
    expect(operations).toEqual(['queued:tenant-a', 'published:tenant-a', 'queued:tenant-b', 'published:tenant-b'])
    expect(result.map(item => item.tenantId)).toEqual(['tenant-a', 'tenant-b'])
  })

  it('records a retryable dispatch failure without allowing queued state to overwrite a worker result', async () => {
    const markQueued = vi.fn().mockResolvedValue({
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'queued',
    })
    const markFailed = vi.fn().mockResolvedValue(undefined)

    await expect(queueRequirementSync(['tenant-a'], 'default', 'project = FUZE', {
      syncCursor: async () => undefined,
      publish: async () => { throw new Error('broker unavailable') },
      markQueued,
      markFailed,
    })).rejects.toThrow('broker unavailable')

    expect(markQueued).toHaveBeenCalledWith('tenant-a')
    expect(markFailed).toHaveBeenCalledWith('tenant-a', 'REQUIREMENT_QUEUE_UNAVAILABLE')
  })

  it('validates the public retry request and rejects unreviewed fields', () => {
    expect(requirementSyncRequestSchema.parse({})).toEqual({ scopeId: 'default' })
    expect(requirementSyncRequestSchema.safeParse({ scopeId: '', tenantId: 'attacker' }).success).toBe(false)
  })

  it('excludes inactive tenants from aggregate requirement freshness', async () => {
    const statuses = await activeRequirementSyncStatuses(['tenant-active'], async tenantId => ({
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'fresh', cursor: tenantId,
    }))

    expect(statuses).toEqual([expect.objectContaining({ cursor: 'tenant-active', freshnessStatus: 'fresh' })])
  })
})
