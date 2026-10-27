import { TOPICS, type SyncCursor } from '@fuzequality/contracts'

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
  },
): Promise<QueuedRequirementSync[]> {
  const queued: QueuedRequirementSync[] = []
  for (const tenantId of tenantIds) {
    const cursor = await dependencies.syncCursor(tenantId)
    await dependencies.publish(TOPICS.REQUIREMENT_SYNC_REQUESTED, {
      tenantId,
      scopeId,
      jql,
      ...(cursor?.cursor ? { since: cursor.cursor } : {}),
    })
    queued.push({
      tenantId,
      incrementalFrom: cursor?.cursor,
      sync: await dependencies.markQueued(tenantId),
    })
  }
  return queued
}
