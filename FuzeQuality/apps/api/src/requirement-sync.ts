import { TOPICS, type SyncCursor } from '@fuzequality/contracts'
import { z } from 'zod'

export const requirementSyncRequestSchema = z.object({
  scopeId: z.string().trim().min(1).max(200).default('default'),
  jql: z.string().trim().min(1).max(10_000).optional(),
}).strict()

export type QueuedRequirementSync = {
  tenantId: string
  incrementalFrom?: string
  sync: SyncCursor
}

export async function queueRequirementSync(
  tenantIds: string[],
  scopeId: string,
  jql: string,
  dependencies: {
    syncCursor: (tenantId: string) => Promise<SyncCursor | undefined>
    publish: (topic: string, payload: unknown) => Promise<void>
    markQueued: (tenantId: string) => Promise<SyncCursor>
    markFailed: (tenantId: string, code: 'REQUIREMENT_QUEUE_UNAVAILABLE') => Promise<void>
  },
): Promise<QueuedRequirementSync[]> {
  const queued: QueuedRequirementSync[] = []
  for (const tenantId of tenantIds) {
    const cursor = await dependencies.syncCursor(tenantId)
    const sync = await dependencies.markQueued(tenantId)
    try {
      await dependencies.publish(TOPICS.REQUIREMENT_SYNC_REQUESTED, {
        tenantId,
        scopeId,
        jql,
        ...(cursor?.cursor ? { since: cursor.cursor } : {}),
      })
      queued.push({ tenantId, incrementalFrom: cursor?.cursor, sync })
    } catch (error) {
      await dependencies.markFailed(tenantId, 'REQUIREMENT_QUEUE_UNAVAILABLE')
      throw error
    }
  }
  return queued
}

export async function activeRequirementSyncStatuses(
  tenantIds: string[],
  syncCursor: (tenantId: string) => Promise<SyncCursor | undefined>,
): Promise<SyncCursor[]> {
  return (await Promise.all(tenantIds.map(syncCursor))).filter(
    (cursor): cursor is SyncCursor => cursor !== undefined,
  )
}
