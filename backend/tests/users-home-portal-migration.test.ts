import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import { up, down, backfillHomePortalIds } from '../src/migrations/019_users_home_portal_id'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import { generatePortalId, ROOT_PORTAL_ID } from '../src/repositories/portalRepository'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `home-portal-${id.slice(0, 8)}@test.local`,
    first_name: 'Home',
    last_name: 'Portal',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createOrgWithPortal(opts: {
  isRoot?: boolean
  slug: string
}): Promise<{ orgId: string; portalId: string }> {
  const ownerId = await createUser()
  const orgId = opts.isRoot ? ROOT_ORG_ID : uuidv4()

  const existingRoot = opts.isRoot
    ? await db('organizations').where({ id: ROOT_ORG_ID }).first()
    : null
  if (!existingRoot) {
    await db('organizations').insert({
      id: orgId,
      name: opts.slug,
      slug: `${opts.slug}-${orgId.slice(0, 6)}`,
      owner_id: ownerId,
      type: opts.isRoot ? 'platform' : 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
  }

  const existingPortal = await db('portals').where({ organization_id: orgId }).first()
  let portalId: string
  if (existingPortal) {
    portalId = existingPortal.id
  } else {
    portalId = opts.isRoot ? ROOT_PORTAL_ID : generatePortalId()
    await db('portals').insert({
      id: portalId,
      organization_id: orgId,
      slug: opts.isRoot ? 'fuzefront' : opts.slug,
      name: opts.slug,
      status: 'active',
      billing_mode: 'free',
      branding: JSON.stringify({ name: opts.slug }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      is_root: !!opts.isRoot,
    })
  }

  return { orgId, portalId }
}

async function addMembership(
  userId: string,
  orgId: string,
  opts: { joinedAt?: Date; status?: string } = {}
): Promise<void> {
  await db('organization_memberships').insert({
    id: uuidv4(),
    user_id: userId,
    organization_id: orgId,
    role: 'member',
    status: opts.status ?? 'active',
    joined_at: opts.joinedAt ?? new Date(),
    permissions: JSON.stringify({}),
    metadata: JSON.stringify({}),
  })
}

describe('019_users_home_portal_id — schema (FF-EPIC-11-S1)', () => {
  it('adds a nullable users.home_portal_id column, FK to portals', async () => {
    expect(await db.schema.hasColumn('users', 'home_portal_id')).toBe(true)
  })

  it('is idempotent — calling up() a second time does not error and leaves the column intact', async () => {
    await expect(up(db)).resolves.toBeUndefined()
    expect(await db.schema.hasColumn('users', 'home_portal_id')).toBe(true)
  })

  it('down() then up() restores the column (schema round-trip)', async () => {
    await down(db)
    expect(await db.schema.hasColumn('users', 'home_portal_id')).toBe(false)
    await up(db)
    expect(await db.schema.hasColumn('users', 'home_portal_id')).toBe(true)
  })
})

describe('backfillHomePortalIds — resolution + edge cases (FF-EPIC-11-S1)', () => {
  it('resolves a user to their non-root org portal', async () => {
    const { orgId, portalId } = await createOrgWithPortal({ slug: `tenant-a-${uuidv4().slice(0, 6)}` })
    const userId = await createUser()
    await addMembership(userId, orgId)

    await backfillHomePortalIds(db)

    const row = await db('users').where({ id: userId }).first()
    expect(row.home_portal_id).toBe(portalId)
  })

  it('leaves a user whose only org has no portal at all as NULL (unresolvable -> root)', async () => {
    const ownerId = await createUser()
    const orgId = uuidv4()
    await db('organizations').insert({
      id: orgId,
      name: 'No Portal Org',
      slug: `no-portal-${orgId.slice(0, 6)}`,
      owner_id: ownerId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
    const userId = await createUser()
    await addMembership(userId, orgId)

    await backfillHomePortalIds(db)

    const row = await db('users').where({ id: userId }).first()
    expect(row.home_portal_id).toBeNull()
  })

  it('leaves a user with no organization membership at all as NULL', async () => {
    const userId = await createUser()

    await backfillHomePortalIds(db)

    const row = await db('users').where({ id: userId }).first()
    expect(row.home_portal_id).toBeNull()
  })

  it('resolves a root-org membership to NULL (not the root portal id)', async () => {
    const { orgId } = await createOrgWithPortal({ isRoot: true, slug: 'fuzefront' })
    const userId = await createUser()
    await addMembership(userId, orgId)

    await backfillHomePortalIds(db)

    const row = await db('users').where({ id: userId }).first()
    expect(row.home_portal_id).toBeNull()
  })

  it('never fails and never drops rows on a mixed legacy-shaped batch', async () => {
    const { orgId, portalId } = await createOrgWithPortal({ slug: `tenant-b-${uuidv4().slice(0, 6)}` })
    const resolvableUser = await createUser()
    await addMembership(resolvableUser, orgId)
    const orphanUser = await createUser() // no membership at all

    const beforeCount = await db('users').count<{ c: string }[]>('* as c')

    await expect(backfillHomePortalIds(db, 2)).resolves.toEqual(expect.any(Number))

    const afterCount = await db('users').count<{ c: string }[]>('* as c')
    expect(afterCount[0].c).toBe(beforeCount[0].c)

    expect((await db('users').where({ id: resolvableUser }).first()).home_portal_id).toBe(portalId)
    expect((await db('users').where({ id: orphanUser }).first()).home_portal_id).toBeNull()
  })

  it('picks the EARLIEST active membership when a user belongs to multiple orgs', async () => {
    const older = await createOrgWithPortal({ slug: `older-${uuidv4().slice(0, 6)}` })
    const newer = await createOrgWithPortal({ slug: `newer-${uuidv4().slice(0, 6)}` })
    const userId = await createUser()
    await addMembership(userId, newer.orgId, { joinedAt: new Date('2026-02-01') })
    await addMembership(userId, older.orgId, { joinedAt: new Date('2026-01-01') })

    await backfillHomePortalIds(db)

    const row = await db('users').where({ id: userId }).first()
    expect(row.home_portal_id).toBe(older.portalId)
  })

  it('ignores a revoked/pending membership in favor of an active one', async () => {
    const active = await createOrgWithPortal({ slug: `active-${uuidv4().slice(0, 6)}` })
    const revoked = await createOrgWithPortal({ slug: `revoked-${uuidv4().slice(0, 6)}` })
    const userId = await createUser()
    await addMembership(userId, revoked.orgId, {
      joinedAt: new Date('2026-01-01'),
      status: 'revoked',
    })
    await addMembership(userId, active.orgId, { joinedAt: new Date('2026-02-01') })

    await backfillHomePortalIds(db)

    const row = await db('users').where({ id: userId }).first()
    expect(row.home_portal_id).toBe(active.portalId)
  })

  it('run-twice no-op — a second backfill pass yields the identical result', async () => {
    const { orgId, portalId } = await createOrgWithPortal({ slug: `rerun-${uuidv4().slice(0, 6)}` })
    const userId = await createUser()
    await addMembership(userId, orgId)

    await backfillHomePortalIds(db)
    const first = (await db('users').where({ id: userId }).first()).home_portal_id
    await backfillHomePortalIds(db)
    const second = (await db('users').where({ id: userId }).first()).home_portal_id

    expect(first).toBe(portalId)
    expect(second).toBe(portalId)
  })

  it('resets a stale value back to NULL when the resolving membership disappears (idempotent re-run)', async () => {
    const { orgId, portalId } = await createOrgWithPortal({ slug: `stale-${uuidv4().slice(0, 6)}` })
    const userId = await createUser()
    const membershipId = uuidv4()
    await db('organization_memberships').insert({
      id: membershipId,
      user_id: userId,
      organization_id: orgId,
      role: 'member',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
    })

    await backfillHomePortalIds(db)
    expect((await db('users').where({ id: userId }).first()).home_portal_id).toBe(portalId)

    // Membership revoked — a re-run must reset the stale portal id to NULL,
    // not leave it pointing at an org the user is no longer active in.
    await db('organization_memberships').where({ id: membershipId }).update({ status: 'revoked' })
    await backfillHomePortalIds(db)
    expect((await db('users').where({ id: userId }).first()).home_portal_id).toBeNull()
  })
})
