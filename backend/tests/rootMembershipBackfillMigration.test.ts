/**
 * FF-EPIC-17-S2 — monolith copy of `backend/security/tests/
 * migrations.rootMembershipBackfill.test.ts`, proving migration 022
 * (root-membership backfill + personal-org reclassify) is correct AND
 * idempotent. Uses the shared jest global setup (tests/setup.ts — real
 * Postgres, full migration chain already applied in beforeAll), then invokes
 * migration 022's `up()` directly a second time (on top of data seeded AFTER
 * the initial migration run) to prove idempotency: no duplicate membership
 * rows, no re-reclassification errors, no diff.
 */
import { v4 as uuidv4 } from 'uuid'

import { db, initializeDatabaseConnection } from '../src/config/database'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import * as migration022 from '../src/migrations/022_root_membership_backfill_and_personal_org_reclassify'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `backfill-${id.slice(0, 8)}@test.local`,
    first_name: 'Backfill',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPersonalOrg(ownerId: string): Promise<string> {
  const id = uuidv4()
  await db('organizations').insert({
    id,
    name: 'Personal',
    slug: `personal-${id.slice(0, 8)}`,
    owner_id: ownerId,
    type: 'personal',
    settings: JSON.stringify({}),
    metadata: JSON.stringify({ personal: true }),
    is_active: true,
    provisioning_state: 'pending',
  })
  return id
}

describe('migration 022 — root-membership backfill + personal-org reclassify (FF-EPIC-17-S2, monolith)', () => {
  it('(a) backfills a root member row for every user lacking one — zero rows deleted', async () => {
    const userWithoutRoot = await createUser()
    const userWithExistingRoot = await createUser()
    await db('organization_memberships').insert({
      id: uuidv4(),
      user_id: userWithExistingRoot,
      organization_id: ROOT_ORG_ID,
      role: 'admin',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
    })

    await migration022.up(db)

    const backfilled = await db('organization_memberships')
      .where({ user_id: userWithoutRoot, organization_id: ROOT_ORG_ID })
      .first()
    expect(backfilled).toMatchObject({ role: 'member', status: 'active' })

    const untouched = await db('organization_memberships')
      .where({ user_id: userWithExistingRoot, organization_id: ROOT_ORG_ID })
      .first()
    expect(untouched.role).toBe('admin')
  })

  it('(b) reclassifies type=personal -> type=organization, non-destructively', async () => {
    const owner = await createUser()
    const personalOrgId = await createPersonalOrg(owner)

    await migration022.up(db)

    const org = await db('organizations').where({ id: personalOrgId }).first()
    expect(org.type).toBe('organization')
    expect(org.owner_id).toBe(owner)
    expect(org.is_active).toBe(true)
    const metadata = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata
    expect(metadata).toEqual({ personal: true })
  })

  it('(c) edge case: a user whose org cannot be resolved still gets a root membership', async () => {
    const orphanUser = await createUser()

    await migration022.up(db)

    const membership = await db('organization_memberships')
      .where({ user_id: orphanUser, organization_id: ROOT_ORG_ID })
      .first()
    expect(membership).toMatchObject({ role: 'member', status: 'active' })
  })

  it('(d) idempotent: running the migration twice produces no diff on the second run', async () => {
    const userId = await createUser()
    await createPersonalOrg(userId)

    await migration022.up(db)

    const rowsAfterFirst = await db('organization_memberships')
      .where({ user_id: userId, organization_id: ROOT_ORG_ID })
    expect(rowsAfterFirst).toHaveLength(1)

    await expect(migration022.up(db)).resolves.toBeUndefined()

    const rowsAfterSecond = await db('organization_memberships')
      .where({ user_id: userId, organization_id: ROOT_ORG_ID })
    expect(rowsAfterSecond).toHaveLength(1)
    expect(rowsAfterSecond[0].id).toBe(rowsAfterFirst[0].id)
  })
})
