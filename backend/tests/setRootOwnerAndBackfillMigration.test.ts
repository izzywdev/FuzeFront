/**
 * FF-EPIC-17 — proves migration 029 (set root owner + backfill root
 * memberships) is correct, idempotent, and safe: it makes the resolved
 * platform owner the explicit owner of the root org, gives every other user a
 * `member` row, upgrades a stale non-owner row for the owner, and — when the
 * root org is absent — does nothing (never throws; creation is 028/015's job).
 *
 * Monolith copy of `backend/security/tests/migrations.setRootOwnerAndBackfill.test.ts`.
 *
 * Every scenario runs inside an always-rolled-back transaction because it
 * mutates / deletes the REAL shared ROOT_ORG_ID row, and the shared test DB is
 * depended on by every other test file. `ROOT_OWNER_EMAIL` is pinned per-test
 * so owner resolution is deterministic.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Knex } from 'knex'

import { db, initializeDatabaseConnection } from '../src/config/database'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import * as migration029 from '../src/migrations/029_set_root_owner_and_backfill_memberships'

class IntentionalTestRollback extends Error {}

beforeAll(() => {
  initializeDatabaseConnection()
})

afterEach(() => {
  delete process.env.ROOT_OWNER_EMAIL
})

async function insertUser(trx: Knex, email: string): Promise<string> {
  const id = uuidv4()
  await trx('users').insert({
    id,
    email,
    first_name: 'RootOwner',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function inRollback(body: (trx: Knex) => Promise<void>): Promise<void> {
  await expect(
    db.transaction(async trx => {
      await body(trx as unknown as Knex)
      throw new IntentionalTestRollback('discard — never persist test mutations to the shared DB')
    }),
  ).rejects.toThrow(IntentionalTestRollback)
}

describe('migration 029 — set root owner + backfill root memberships (FF-EPIC-17, #750, monolith)', () => {
  it('sets owner_id + owner membership on root, and backfills members for everyone else', async () => {
    const ownerEmail = `root-owner-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)
      const otherId = await insertUser(trx, `other-${uuidv4().slice(0, 8)}@test.local`)

      await migration029.up(trx)

      const root = await trx('organizations').where({ id: ROOT_ORG_ID }).first()
      expect(root.owner_id).toBe(ownerId)

      const ownerMembership = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
        .first()
      expect(ownerMembership.role).toBe('owner')
      expect(ownerMembership.status).toBe('active')

      const otherMembership = await trx('organization_memberships')
        .where({ user_id: otherId, organization_id: ROOT_ORG_ID })
        .first()
      expect(otherMembership.role).toBe('member')
    })

    expect(await db('organizations').where({ id: ROOT_ORG_ID }).first()).toBeDefined()
  })

  it('upgrades a stale non-owner membership for the owner to owner', async () => {
    const ownerEmail = `root-upgrade-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)
      await trx('organization_memberships').insert({
        id: uuidv4(),
        user_id: ownerId,
        organization_id: ROOT_ORG_ID,
        role: 'member',
        status: 'active',
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })

      await migration029.up(trx)

      const rows = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0].role).toBe('owner')
    })
  })

  it('is idempotent: a second run does not duplicate or downgrade', async () => {
    const ownerEmail = `root-idem-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)

      await migration029.up(trx)
      await migration029.up(trx)

      const rows = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0].role).toBe('owner')

      const root = await trx('organizations').where({ id: ROOT_ORG_ID }).first()
      expect(root.owner_id).toBe(ownerId)
    })
  })

  it('SAFE-SKIP: does nothing (no throw, no create) when the root org is absent', async () => {
    const ownerEmail = `root-absent-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)
      await trx('organizations').where({ id: ROOT_ORG_ID }).del()

      await migration029.up(trx) // must not throw

      expect(await trx('organizations').where({ id: ROOT_ORG_ID }).first()).toBeUndefined()
      const ownerMembership = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
        .first()
      expect(ownerMembership).toBeUndefined()
    })

    expect(await db('organizations').where({ id: ROOT_ORG_ID }).first()).toBeDefined()
  })
})
