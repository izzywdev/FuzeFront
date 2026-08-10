import {
  applyEventToRefIndex,
  assertRefExists,
  mintId,
  toUuid,
  RefIndexError,
  REF_INDEX_TOPICS,
  TOPIC_PROJECTIONS,
} from '../src'
import type { EntityType, RefIndexStore, RefRecord } from '../src'

/** In-memory store — the projection logic is pure routing, so no broker or DB. */
class MemoryRefIndex implements RefIndexStore {
  readonly rows = new Map<string, RefRecord>()
  applied: Date | null = null

  private key(type: EntityType, id: string, tenantId?: string | null) {
    return `${type}|${id}|${tenantId ?? ''}`
  }

  async has(type: EntityType, id: string, tenantId?: string | null) {
    const row = this.rows.get(this.key(type, id, tenantId))
    return row?.status === 'active'
  }

  async upsert(record: RefRecord) {
    this.rows.set(this.key(record.entityType, record.entityId, record.tenantId), record)
    this.applied = new Date()
  }

  async markDeleted(type: EntityType, id: string, tenantId?: string | null) {
    this.rows.set(this.key(type, id, tenantId), {
      entityType: type,
      entityId: id,
      tenantId: tenantId ?? null,
      status: 'deleted',
    })
    this.applied = new Date()
  }

  async lastAppliedAt() {
    return this.applied
  }

  async isEmpty() {
    return this.rows.size === 0
  }
}

const USER_UUID = '0195a8f2-6c3d-7f11-8b2a-2c9f4d1e7a01'

describe('applyEventToRefIndex', () => {
  it('projects a created event', async () => {
    const store = new MemoryRefIndex()
    const handled = await applyEventToRefIndex(store, 'identity.user.created', {
      userId: USER_UUID,
      email: 'a@b.c',
      intent: 'signup',
    })
    expect(handled).toBe(true)
    expect(await store.has('user', USER_UUID)).toBe(true)
  })

  it('tombstones on delete rather than removing the row', async () => {
    const store = new MemoryRefIndex()
    await applyEventToRefIndex(store, 'identity.user.created', { userId: USER_UUID })
    await applyEventToRefIndex(store, 'identity.user.deleted', { userId: USER_UUID })
    expect(await store.has('user', USER_UUID)).toBe(false)

    // A redelivered `created` must not resurrect a deleted entity — consumers
    // redeliver freely, and Kafka gives no ordering across partitions.
    await applyEventToRefIndex(store, 'identity.user.created', { userId: USER_UUID })
    expect(store.rows.get(`user|${USER_UUID}|`)?.status).toBe('active')
  })

  it('is idempotent — redelivery does not corrupt the projection', async () => {
    const store = new MemoryRefIndex()
    for (let i = 0; i < 3; i++) {
      await applyEventToRefIndex(store, 'identity.user.created', { userId: USER_UUID })
    }
    expect(store.rows.size).toBe(1)
    expect(await store.has('user', USER_UUID)).toBe(true)
  })

  it('uses the field names the shipped schemas actually declare', async () => {
    const store = new MemoryRefIndex()
    // identity.org.* carries `organizationId`, NOT `orgId`.
    const handled = await applyEventToRefIndex(store, 'identity.org.created', {
      organizationId: USER_UUID,
      slug: 'acme',
    })
    expect(handled).toBe(true)
    expect(await store.has('organization', USER_UUID)).toBe(true)
  })

  it('carries the tenant scope when the event has one', async () => {
    const store = new MemoryRefIndex()
    await applyEventToRefIndex(store, 'portal.created', {
      portalId: 'prt_abc',
      organizationId: 'org-1',
    })
    expect(await store.has('portal', 'prt_abc', 'org-1')).toBe(true)
    expect(await store.has('portal', 'prt_abc', 'other-org')).toBe(false)
  })

  it('ignores an unmapped topic instead of throwing', async () => {
    const store = new MemoryRefIndex()
    expect(await applyEventToRefIndex(store, 'billing.usage.recorded', { x: 1 })).toBe(false)
  })

  it('ignores a payload missing its id field instead of throwing', async () => {
    // A consumer that dies on one unexpected message stops projecting
    // EVERYTHING, which is far worse than one skipped row.
    const store = new MemoryRefIndex()
    expect(await applyEventToRefIndex(store, 'identity.user.created', { email: 'a@b.c' })).toBe(
      false
    )
    expect(store.rows.size).toBe(0)
  })

  it('does not claim app.registered coverage — that event carries no app id', () => {
    expect(REF_INDEX_TOPICS).not.toContain('app.registered')
    expect(TOPIC_PROJECTIONS['app.registered']).toBeUndefined()
  })
})

describe('assertRefExists', () => {
  it('accepts a reference the projection knows, with no network call', async () => {
    const store = new MemoryRefIndex()
    const id = mintId('user')
    await applyEventToRefIndex(store, 'identity.user.created', { userId: toUuid(id) })
    await expect(assertRefExists(store, 'user', id, { mode: 'enforce' })).resolves.toBe(id)
  })

  it('rejects an unknown reference in enforce mode', async () => {
    const store = new MemoryRefIndex()
    await store.upsert({
      entityType: 'user',
      entityId: USER_UUID,
      tenantId: null,
      status: 'active',
    })
    const stranger = mintId('user')
    await expect(assertRefExists(store, 'user', stranger, { mode: 'enforce' })).rejects.toThrow(
      RefIndexError
    )
  })

  it('applies L0 before L1 — the wrong KIND fails even if the id exists', async () => {
    const store = new MemoryRefIndex()
    const customer = mintId('customer')
    await store.upsert({
      entityType: 'invoice',
      entityId: toUuid(customer),
      tenantId: null,
      status: 'active',
    })
    // Same 128 bits, wrong type. Only the prefix check catches this, and it
    // catches it without consulting the projection at all.
    await expect(assertRefExists(store, 'invoice', customer, { mode: 'enforce' })).rejects.toThrow(
      /prefix|expected/i
    )
  })

  it('warns but allows by default, because a projection lags', async () => {
    const store = new MemoryRefIndex()
    const warnings: string[] = []
    const id = mintId('user')
    await expect(
      assertRefExists(store, 'user', id, { onWarn: (m) => warnings.push(m) })
    ).resolves.toBe(id)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/unknown reference/)
  })

  it('degrades enforce to allow when the projection is stale', async () => {
    // The failure this prevents: Kafka is down, nothing new is projected, and an
    // integrity check that is supposed to be free starts rejecting every
    // reference to a recent entity — taking the write path down with the bus.
    const store = new MemoryRefIndex()
    store.applied = new Date('2026-01-01T00:00:00Z')
    const warnings: string[] = []
    const id = mintId('user')
    await expect(
      assertRefExists(store, 'user', id, {
        mode: 'enforce',
        staleAfterMs: 60_000,
        now: () => new Date('2026-01-01T01:00:00Z'),
        onWarn: (m) => warnings.push(m) as unknown as void,
      })
    ).resolves.toBe(id)
    expect(warnings[0]).toMatch(/stale/)
  })

  it('still enforces when the projection is fresh', async () => {
    const store = new MemoryRefIndex()
    store.applied = new Date('2026-01-01T00:59:30Z')
    await expect(
      assertRefExists(store, 'user', mintId('user'), {
        mode: 'enforce',
        staleAfterMs: 60_000,
        now: () => new Date('2026-01-01T01:00:00Z'),
      })
    ).rejects.toThrow(RefIndexError)
  })

  it('fails closed when staleAfterMs is disabled, even with an empty projection', async () => {
    const store = new MemoryRefIndex()
    await expect(
      assertRefExists(store, 'user', mintId('user'), { mode: 'enforce', staleAfterMs: null })
    ).rejects.toThrow(RefIndexError)
  })

  it('rejects a reference to a DELETED entity', async () => {
    const store = new MemoryRefIndex()
    const id = mintId('user')
    await applyEventToRefIndex(store, 'identity.user.created', { userId: toUuid(id) })
    await applyEventToRefIndex(store, 'identity.user.deleted', { userId: toUuid(id) })
    await expect(assertRefExists(store, 'user', id, { mode: 'enforce' })).rejects.toThrow(
      RefIndexError
    )
  })
})
