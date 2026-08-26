// Unit tests for the FFRNT P2 ref-index feature flag integration.
//
// Covers:
//   1. isRefEnforceEnabled returns false (default) when flag client is absent.
//   2. isRefEnforceEnabled returns false when the flag is OFF.
//   3. isRefEnforceEnabled returns true when the flag is ON.
//   4. isRefEnforceEnabled returns false (fail-safe) when the client throws.
//   5. assertRefExists in mode='warn': unknown ref allowed (no throw).
//   6. assertRefExists in mode='warn': warns for unknown ref, does not throw.
//   7. assertRefExists in mode='enforce': unknown ref THROWS RefIndexError.
//   8. assertRefExists in mode='enforce': degrades to warn when projection stale.
//   9. assertRefExists in mode='enforce': known ref returns EntityId (happy path).
//  10. flag=OFF + unknown org → warn path (request proceeds).
//  11. flag=ON + unknown org → enforce path (RefIndexError thrown).
//  12. flag=ON + known org → request proceeds.
//  13-17. applyEventToRefIndex: projection mapping smoke-tests.
//
// No DB, no Kafka, no network. Uses the DI seams provided by flags.ts
// (setFlagClient) and an in-memory RefIndexStore.

import { setFlagClient, isRefEnforceEnabled, FlagClientLike } from '../src/app-registry/flags'
import {
  assertRefExists,
  RefIndexStore,
  RefRecord,
  RefIndexError,
  applyEventToRefIndex,
  mintId,
  toUuid,
} from '@izzywdev/fuzefront-identity'

// ---------------------------------------------------------------------------
// In-memory RefIndexStore
// ---------------------------------------------------------------------------

class MemRefStore implements RefIndexStore {
  private rows: Map<string, RefRecord> = new Map()
  private _lastApplied: Date | null = null

  private key(t: string, id: string, tenant: string | null | undefined): string {
    return `${t}:${id}:${tenant ?? ''}`
  }

  async has(entityType: string, entityId: string, tenantId?: string | null): Promise<boolean> {
    const r = this.rows.get(this.key(entityType, entityId, tenantId))
    return r !== undefined && r.status === 'active'
  }

  async upsert(record: RefRecord): Promise<void> {
    this.rows.set(this.key(record.entityType, record.entityId, record.tenantId), record)
    this._lastApplied = new Date()
  }

  async markDeleted(entityType: string, entityId: string, tenantId?: string | null): Promise<void> {
    const k = this.key(entityType, entityId, tenantId)
    const existing = this.rows.get(k)
    if (existing) {
      this.rows.set(k, { ...existing, status: 'deleted' })
    } else {
      this.rows.set(k, { entityType: entityType as any, entityId, tenantId, status: 'deleted' })
    }
    this._lastApplied = new Date()
  }

  async lastAppliedAt(): Promise<Date | null> {
    return this._lastApplied
  }

  async isEmpty(): Promise<boolean> {
    return this.rows.size === 0
  }
}

// ---------------------------------------------------------------------------
// Fake flag client
// ---------------------------------------------------------------------------

function makeFlagClient(values: Record<string, boolean>): FlagClientLike {
  return {
    async getBooleanValue(key: string, defaultValue: boolean): Promise<boolean> {
      return key in values ? values[key] : defaultValue
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers — seed a MemRefStore with a known org / user entity. Real events
// carry bare UUIDs (not TypeIDs); assertRefExists converts TypeIDs to UUID
// form before calling store.has(), so seeds must use the UUID form.
// ---------------------------------------------------------------------------

async function seedOrg(store: MemRefStore, typeId: string): Promise<void> {
  const uuid = toUuid(typeId as any)
  await store.upsert({ entityType: 'organization', entityId: uuid, tenantId: null, status: 'active' })
}

async function seedUser(store: MemRefStore, typeId: string): Promise<void> {
  const uuid = toUuid(typeId as any)
  await store.upsert({ entityType: 'user', entityId: uuid, tenantId: null, status: 'active' })
}

/**
 * Mint a valid org TypeID for testing.
 * assertRefExists runs an L0 prefix check first, so the id must carry the
 * real 'org' prefix — fabricated strings like 'org_abc_...' fail that check.
 */
function freshOrgId(): string {
  return mintId('organization')
}

function freshUserId(): string {
  return mintId('user')
}

// ---------------------------------------------------------------------------
// Teardown: always clear the injected client after each test.
// ---------------------------------------------------------------------------

afterEach(() => {
  setFlagClient(null)
})

// ---------------------------------------------------------------------------
// 1-4: isRefEnforceEnabled — flag states
// ---------------------------------------------------------------------------

describe('isRefEnforceEnabled — flag states', () => {
  it('returns false (OFF default) when no flag client is injected', async () => {
    setFlagClient(null)
    const result = await isRefEnforceEnabled()
    expect(result).toBe(false)
  })

  it('returns false when the flag is OFF', async () => {
    setFlagClient(makeFlagClient({ 'fuzefront.ref-index.enforce-ref-checks': false }))
    const result = await isRefEnforceEnabled({ organizationId: freshOrgId(), userId: freshUserId() })
    expect(result).toBe(false)
  })

  it('returns true when the flag is ON', async () => {
    setFlagClient(makeFlagClient({ 'fuzefront.ref-index.enforce-ref-checks': true }))
    const result = await isRefEnforceEnabled({ organizationId: freshOrgId(), userId: freshUserId() })
    expect(result).toBe(true)
  })

  it('returns false (fail-safe) when the flag client throws', async () => {
    const throwingClient: FlagClientLike = {
      async getBooleanValue(): Promise<boolean> {
        throw new Error('connection refused')
      },
    }
    setFlagClient(throwingClient)
    const result = await isRefEnforceEnabled()
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5-9: assertRefExists — behavior in both modes
//
// NOTE: assertRefExists calls assertRef (L0) first to validate the TypeID
// prefix. Tests must use mintId() to get real ids, not fabricated strings.
// ---------------------------------------------------------------------------

describe('assertRefExists — warn mode (flag OFF path)', () => {
  it('allows an unknown org through (no throw)', async () => {
    const store = new MemRefStore()
    // Seed with a different org so the store is non-empty and projection is fresh.
    await seedOrg(store, freshOrgId())

    const unknownOrgId = freshOrgId()
    await expect(
      assertRefExists(store, 'organization', unknownOrgId, { mode: 'warn' })
    ).resolves.not.toThrow()
  })

  it('emits a warning for an unknown org but does not throw', async () => {
    const store = new MemRefStore()
    // Seed so lastAppliedAt is recent — the stale-degrade logic won't fire.
    await seedOrg(store, freshOrgId())

    const warnings: string[] = []
    const unknownOrgId = freshOrgId()
    await assertRefExists(store, 'organization', unknownOrgId, {
      mode: 'warn',
      onWarn: (msg) => warnings.push(msg),
    })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/unknown reference/)
  })
})

describe('assertRefExists — enforce mode (flag ON path)', () => {
  it('throws RefIndexError for an unknown org when projection is fresh', async () => {
    const store = new MemRefStore()
    // Seed a different org so the store is fresh.
    await seedOrg(store, freshOrgId())

    const unknownOrgId = freshOrgId()
    await expect(
      assertRefExists(store, 'organization', unknownOrgId, {
        mode: 'enforce',
        staleAfterMs: 300_000,
        now: () => new Date(), // projection was just seeded: fresh
      })
    ).rejects.toBeInstanceOf(RefIndexError)
  })

  it('degrades to warn (does NOT throw) when projection is stale', async () => {
    const store = new MemRefStore()
    // Seed so the store has rows, then fake lastAppliedAt to 10 min ago.
    await seedOrg(store, freshOrgId())
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    store.lastAppliedAt = async () => tenMinAgo

    const unknownOrgId = freshOrgId()
    // staleAfterMs=5min, actual lag=10min → degrade to warn.
    await expect(
      assertRefExists(store, 'organization', unknownOrgId, {
        mode: 'enforce',
        staleAfterMs: 300_000,
        now: () => new Date(),
      })
    ).resolves.not.toThrow()
  })

  it('returns the EntityId for a known org (happy path)', async () => {
    const store = new MemRefStore()
    const orgId = freshOrgId()
    await seedOrg(store, orgId)

    const result = await assertRefExists(store, 'organization', orgId, { mode: 'enforce' })
    expect(typeof result).toBe('string')
    // result should be the same TypeID (same wire form)
    expect(result).toBe(orgId)
  })
})

// ---------------------------------------------------------------------------
// 10-12: Full flag + assertRefExists integration
// ---------------------------------------------------------------------------

describe('flag + assertRefExists integration', () => {
  it('flag=OFF + unknown org → warn path (no throw)', async () => {
    setFlagClient(makeFlagClient({ 'fuzefront.ref-index.enforce-ref-checks': false }))
    const store = new MemRefStore()
    // Seed so projection is fresh.
    await seedOrg(store, freshOrgId())

    const unknownOrgId = freshOrgId()
    const flagOn = await isRefEnforceEnabled({ organizationId: unknownOrgId })
    const mode = flagOn ? 'enforce' : 'warn'
    expect(mode).toBe('warn')

    await expect(
      assertRefExists(store, 'organization', unknownOrgId, { mode })
    ).resolves.not.toThrow()
  })

  it('flag=ON + unknown org → enforce path (throws RefIndexError)', async () => {
    setFlagClient(makeFlagClient({ 'fuzefront.ref-index.enforce-ref-checks': true }))
    const store = new MemRefStore()
    // Seed so projection is fresh.
    await seedOrg(store, freshOrgId())

    const unknownOrgId = freshOrgId()
    const flagOn = await isRefEnforceEnabled({ organizationId: unknownOrgId })
    const mode = flagOn ? 'enforce' : 'warn'
    expect(mode).toBe('enforce')

    await expect(
      assertRefExists(store, 'organization', unknownOrgId, {
        mode,
        now: () => new Date(),
      })
    ).rejects.toBeInstanceOf(RefIndexError)
  })

  it('flag=ON + known org → resolves (happy path)', async () => {
    setFlagClient(makeFlagClient({ 'fuzefront.ref-index.enforce-ref-checks': true }))
    const store = new MemRefStore()
    const knownOrgId = freshOrgId()
    await seedOrg(store, knownOrgId)

    const flagOn = await isRefEnforceEnabled({ organizationId: knownOrgId })
    const mode = flagOn ? 'enforce' : 'warn'

    await expect(
      assertRefExists(store, 'organization', knownOrgId, { mode })
    ).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 13-17: applyEventToRefIndex — projection mapping smoke-tests.
//
// Real events carry bare UUIDs in their id fields, so the store is seeded with
// UUIDs. These tests verify the topic-to-projection routing only; the L0+L1
// combination is tested in the integration suite above.
// ---------------------------------------------------------------------------

describe('applyEventToRefIndex — projection mapping', () => {
  it('upserts an org on identity.org.created and marks it as active', async () => {
    const store = new MemRefStore()
    const uuid = toUuid(freshOrgId() as any)
    const applied = await applyEventToRefIndex(store, 'identity.org.created', {
      organizationId: uuid,
    })
    expect(applied).toBe(true)
    const has = await store.has('organization', uuid)
    expect(has).toBe(true)
  })

  it('marks deleted on identity.org.deleted', async () => {
    const store = new MemRefStore()
    const uuid = toUuid(freshOrgId() as any)
    await applyEventToRefIndex(store, 'identity.org.created', { organizationId: uuid })
    await applyEventToRefIndex(store, 'identity.org.deleted', { organizationId: uuid })
    const has = await store.has('organization', uuid)
    expect(has).toBe(false)
  })

  it('upserts a user on identity.user.created', async () => {
    const store = new MemRefStore()
    const uuid = toUuid(freshUserId() as any)
    const applied = await applyEventToRefIndex(store, 'identity.user.created', {
      userId: uuid,
    })
    expect(applied).toBe(true)
    const has = await store.has('user', uuid)
    expect(has).toBe(true)
  })

  it('ignores unknown topics and returns false', async () => {
    const store = new MemRefStore()
    const applied = await applyEventToRefIndex(store, 'some.random.topic', { id: '123' })
    expect(applied).toBe(false)
    const empty = await store.isEmpty()
    expect(empty).toBe(true)
  })

  it('ignores events with a missing id field and returns false', async () => {
    const store = new MemRefStore()
    // identity.org.created expects organizationId — send without it.
    const applied = await applyEventToRefIndex(store, 'identity.org.created', {
      slug: 'missing-id',
    })
    expect(applied).toBe(false)
    const empty = await store.isEmpty()
    expect(empty).toBe(true)
  })
})
