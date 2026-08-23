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
import type { Knex } from 'knex'

import { db, initializeDatabaseConnection } from '../src/config/database'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import * as migration022 from '../src/migrations/022_root_membership_backfill_and_personal_org_reclassify'

/** Thrown at the end of a probe transaction to force a rollback without ever
 * committing — used by the (e) regression test below so it can delete the
 * REAL, shared ROOT_ORG_ID row (to simulate the prod #750 precondition) and
 * be certain nothing it did leaks into the shared test database that every
 * other test file in this suite run also depends on. */
class IntentionalTestRollback extends Error {}

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

  it('(e) REGRESSION 2026-08-23: skips the reclassify (not just the backfill) when the root org is absent — the prod #750 strand-every-user bug', async () => {
    // Runs entirely inside one transaction that is ALWAYS rolled back (via the
    // thrown sentinel below), so deleting the real, shared ROOT_ORG_ID row —
    // the exact prod precondition (#750: the row does not exist) — can never
    // leak into the shared test database other test files in this run depend on.
    await expect(
      db.transaction(async trx => {
        const owner = await (async () => {
          const id = uuidv4()
          await trx('users').insert({
            id,
            email: `regress-${id.slice(0, 8)}@test.local`,
            first_name: 'Regress',
            last_name: 'Test',
            roles: JSON.stringify(['user']),
            created_at: new Date(),
            updated_at: new Date(),
          })
          return id
        })()

        const personalOrgId = uuidv4()
        await trx('organizations').insert({
          id: personalOrgId,
          name: 'Personal',
          slug: `personal-${personalOrgId.slice(0, 8)}`,
          owner_id: owner,
          type: 'personal',
          settings: JSON.stringify({}),
          metadata: JSON.stringify({ personal: true }),
          is_active: true,
          provisioning_state: 'pending',
        })

        // Simulate the prod precondition: the root org row does not exist.
        await trx('organizations').where({ id: ROOT_ORG_ID }).del()

        await migration022.up(trx as unknown as Knex)

        // (a) is unaffected by this change — still skips, as before.
        const rootMembership = await trx('organization_memberships')
          .where({ user_id: owner, organization_id: ROOT_ORG_ID })
          .first()
        expect(rootMembership).toBeUndefined()

        // (b) — THE FIX: must ALSO skip. The pre-fix behavior reclassified
        // this row to 'organization' anyway, stranding the user with neither
        // a personal org nor a root membership.
        const org = await trx('organizations').where({ id: personalOrgId }).first()
        expect(org.type).toBe('personal')

        throw new IntentionalTestRollback('discard — never persist the deleted root org')
      })
    ).rejects.toThrow(IntentionalTestRollback)

    // Confirm the rollback actually happened: ROOT_ORG_ID is back.
    const rootOrg = await db('organizations').where({ id: ROOT_ORG_ID }).first()
    expect(rootOrg).toBeDefined()
  })
})
