/**
 * Unit tests — `identity.membership.added` outbox emits from
 * organizationProvisioning.ts (personal-org owner, self-heal owner,
 * root `member`, developer). No Postgres: a tiny table-aware knex fake is
 * injected and `enqueueEvent` is stubbed so we assert topic + payload.
 *
 * The key regression guard: these upserts run on EVERY login, so a repeat call
 * where `ON CONFLICT DO NOTHING` inserted no row must NOT emit a spurious add.
 */
jest.mock('../src/config/database', () => ({ db: jest.fn() }))
jest.mock('../src/utils/permit/tenant-management', () => ({
  createTenantInPermit: jest.fn().mockResolvedValue(true),
}))
jest.mock('../src/utils/permit/user-sync', () => ({
  syncUserToPermit: jest.fn().mockResolvedValue(true),
}))
jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {},
}))
jest.mock('@fuzefront/core', () => ({
  ...jest.requireActual('@fuzefront/core'),
  enqueueEvent: jest.fn().mockResolvedValue(undefined),
}))

import { enqueueEvent } from '@fuzefront/core'
import { TOPICS } from '@fuzefront/shared/kafka'
import {
  ensurePersonalOrg,
  ensureRootMembership,
  ensureDeveloperMembership,
} from '../src/services/organizationProvisioning'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'

const enqueueEventMock = enqueueEvent as jest.Mock

interface TableCfg {
  /** Successive results for `.first()` (last one repeats). */
  first?: any[]
  /** Rows an `.insert().returning()` resolves to. */
  insertRows?: any[]
}

/** Table-aware knex fake: db(table) and trx(table) share the same config. */
function makeFakeDb(tables: Record<string, TableCfg>, opts: { txFailures?: any[] } = {}) {
  const firstCounters: Record<string, number> = {}
  const inserts: Array<{ table: string; row: any }> = []
  const txFailures = [...(opts.txFailures ?? [])]

  const table = (name: string) => {
    const cfg = tables[name] ?? {}
    let op: 'select' | 'insert' = 'select'
    const b: any = {
      where: () => b,
      onConflict: () => b,
      ignore: () => b,
      returning: () => b,
      update: () => b,
      insert: (row: any) => {
        op = 'insert'
        inserts.push({ table: name, row })
        return b
      },
      first: async () => {
        const seq = cfg.first ?? []
        const i = firstCounters[name] ?? 0
        firstCounters[name] = i + 1
        return seq[Math.min(i, seq.length - 1)]
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(op === 'insert' ? cfg.insertRows ?? [] : []).then(resolve, reject),
    }
    return b
  }

  const trx: any = (name: string) => table(name)
  trx.raw = (s: string) => s
  trx.fn = { now: () => 'now()' }
  const db: any = (name: string) => table(name)
  db.fn = { now: () => 'now()' }
  db.raw = (s: string) => s
  db.transaction = jest.fn(async (cb: any) => {
    const failure = txFailures.shift()
    if (failure) throw failure
    return cb(trx)
  })
  return { db, trx, inserts }
}

const USER_ID = 'user-1111'
const ORG_ID = 'org-2222'

beforeEach(() => {
  enqueueEventMock.mockClear()
})

describe('ensurePersonalOrg — owner membership emit (site 1)', () => {
  const personalOrgRow = { id: ORG_ID, owner_id: USER_ID, type: 'personal', slug: `personal-${USER_ID}` }

  it('emits identity.membership.added (owner) when the owner row was actually inserted', async () => {
    const { db, trx } = makeFakeDb({
      organizations: { first: [undefined, personalOrgRow, personalOrgRow] },
      users: { first: [{ id: USER_ID }] },
      organization_memberships: { insertRows: [{ id: 'm-1' }] },
    })

    await ensurePersonalOrg(USER_ID, { db })

    expect(enqueueEventMock).toHaveBeenCalledTimes(1)
    const [trxArg, topic, payload, correlationId] = enqueueEventMock.mock.calls[0]
    expect(trxArg).toBe(trx)
    expect(topic).toBe(TOPICS.IDENTITY_MEMBERSHIP_ADDED)
    expect(payload).toEqual({ organizationId: ORG_ID, userId: USER_ID, role: 'owner' })
    expect(correlationId).toMatch(/^identity-membership-added-[0-9a-f-]{36}$/)
  })

  it('does NOT emit when ON CONFLICT ignored the insert (membership already existed)', async () => {
    const { db, inserts } = makeFakeDb({
      organizations: { first: [undefined, personalOrgRow, personalOrgRow] },
      users: { first: [{ id: USER_ID }] },
      organization_memberships: { insertRows: [] },
    })

    await ensurePersonalOrg(USER_ID, { db })

    expect(inserts.some(i => i.table === 'organization_memberships')).toBe(true)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })

  it('does NOT emit when the personal org already exists (early return, no writes)', async () => {
    const { db, inserts } = makeFakeDb({
      organizations: { first: [personalOrgRow] },
    })

    await ensurePersonalOrg(USER_ID, { db })

    expect(inserts).toHaveLength(0)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })
})

describe('ensurePersonalOrg — slug-conflict self-heal owner emit (site 2)', () => {
  const slugConflict = Object.assign(new Error('dup slug'), {
    code: '23505',
    constraint: 'organizations_slug_unique',
  })
  const healedOrg = { id: ORG_ID, owner_id: USER_ID, type: 'personal', slug: `personal-${USER_ID}` }

  it('emits identity.membership.added (owner) when the self-heal insert wrote a row', async () => {
    const { db, trx } = makeFakeDb(
      {
        organizations: { first: [undefined, healedOrg, healedOrg] },
        users: { first: [{ id: USER_ID }] },
        organization_memberships: { insertRows: [{ id: 'm-1' }] },
      },
      { txFailures: [slugConflict] }
    )

    await ensurePersonalOrg(USER_ID, { db })

    expect(enqueueEventMock).toHaveBeenCalledTimes(1)
    const [trxArg, topic, payload] = enqueueEventMock.mock.calls[0]
    expect(trxArg).toBe(trx)
    expect(topic).toBe(TOPICS.IDENTITY_MEMBERSHIP_ADDED)
    expect(payload).toEqual({ organizationId: ORG_ID, userId: USER_ID, role: 'owner' })
  })

  it('does NOT emit when the self-heal insert was a no-op (membership already present)', async () => {
    const { db, inserts } = makeFakeDb(
      {
        organizations: { first: [undefined, healedOrg, healedOrg] },
        users: { first: [{ id: USER_ID }] },
        organization_memberships: { insertRows: [] },
      },
      { txFailures: [slugConflict] }
    )

    await ensurePersonalOrg(USER_ID, { db })

    expect(inserts.some(i => i.table === 'organization_memberships')).toBe(true)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })
})

describe('ensureRootMembership — root `member` emit (site 3)', () => {
  it('emits identity.membership.added (member) on the root org when a row was inserted', async () => {
    const { db, trx } = makeFakeDb({
      organizations: { first: [{ id: ROOT_ORG_ID }] },
      organization_memberships: { insertRows: [{ id: 'm-1' }] },
    })

    await ensureRootMembership(USER_ID, { db })

    expect(enqueueEventMock).toHaveBeenCalledTimes(1)
    const [trxArg, topic, payload] = enqueueEventMock.mock.calls[0]
    expect(trxArg).toBe(trx)
    expect(topic).toBe(TOPICS.IDENTITY_MEMBERSHIP_ADDED)
    expect(payload).toEqual({ organizationId: ROOT_ORG_ID, userId: USER_ID, role: 'member' })
  })

  it('does NOT emit on a repeat login (ON CONFLICT inserted no row)', async () => {
    const { db, inserts } = makeFakeDb({
      organizations: { first: [{ id: ROOT_ORG_ID }] },
      organization_memberships: { insertRows: [] },
    })

    await ensureRootMembership(USER_ID, { db })

    expect(inserts.some(i => i.table === 'organization_memberships')).toBe(true)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })

  it('does NOT emit when the root org is absent (skipped)', async () => {
    const { db, inserts } = makeFakeDb({ organizations: { first: [undefined] } })

    await ensureRootMembership(USER_ID, { db })

    expect(inserts).toHaveLength(0)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })
})

describe('ensureDeveloperMembership — developer emit (site 4)', () => {
  it('emits identity.membership.added (developer) when no prior root membership existed', async () => {
    const { db, trx } = makeFakeDb({
      organizations: { first: [{ id: ROOT_ORG_ID }] },
      organization_memberships: { first: [undefined], insertRows: [{ id: 'm-1' }] },
    })

    await ensureDeveloperMembership(USER_ID, { db })

    expect(enqueueEventMock).toHaveBeenCalledTimes(1)
    const [trxArg, topic, payload] = enqueueEventMock.mock.calls[0]
    expect(trxArg).toBe(trx)
    expect(topic).toBe(TOPICS.IDENTITY_MEMBERSHIP_ADDED)
    expect(payload).toEqual({ organizationId: ROOT_ORG_ID, userId: USER_ID, role: 'developer' })
  })

  it('does NOT emit when a root membership already exists (metadata-only update)', async () => {
    const { db } = makeFakeDb({
      organizations: { first: [{ id: ROOT_ORG_ID }] },
      organization_memberships: {
        first: [{ id: 'm-0', role: 'admin', metadata: '{}' }],
      },
    })

    await ensureDeveloperMembership(USER_ID, { db })

    expect(enqueueEventMock).not.toHaveBeenCalled()
  })

  it('does NOT emit when a concurrent insert won the race (insert returned no row)', async () => {
    const { db, inserts } = makeFakeDb({
      organizations: { first: [{ id: ROOT_ORG_ID }] },
      organization_memberships: { first: [undefined], insertRows: [] },
    })

    await ensureDeveloperMembership(USER_ID, { db })

    expect(inserts.some(i => i.table === 'organization_memberships')).toBe(true)
    expect(enqueueEventMock).not.toHaveBeenCalled()
  })
})
