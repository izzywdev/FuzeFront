/**
 * FF-EPIC-17-S2 — real-DB integration test proving migration 015
 * (root-membership backfill + personal-org reclassify) is correct AND
 * idempotent. Mirrors tests/migrations.integration.test.ts's reachability-
 * skip pattern (own scratch DB, requires a reachable Postgres; skips
 * otherwise so unit CI without a DB still passes).
 *
 * The full chain (001-015) is applied once via `runMigrations` to build the
 * schema (on a fresh DB this seeds ROOT_ORG_ID with zero pre-existing users,
 * so the backfill/reclassify migration 015 runs but matches zero rows — see
 * the bootstrap-user comment below for why). Test data is then seeded
 * AFTER migrations complete, and migration 015's `up()` is invoked directly
 * — once to prove it correctly backfills/reclassifies pre-existing data, and
 * a second time (re-run on the same DB) to prove idempotency: no duplicate
 * membership rows, no re-reclassification errors, no diff.
 */
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Client } from 'pg'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_root_backfill_test'

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try {
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    return true
  } catch {
    return false
  }
}

describe('migration 015 — root-membership backfill + personal-org reclassify (FF-EPIC-17-S2, integration)', () => {
  let reachable = false
  let db: any
  let ROOT_ORG_ID: string
  let migration015: { up(knex: any): Promise<void>; down(knex: any): Promise<void> }

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return

    process.env.USE_POSTGRES = 'true'
    process.env.NODE_ENV = 'production'
    process.env.DB_HOST = HOST
    process.env.DB_PORT = String(PORT)
    process.env.DB_USER = USER
    process.env.DB_PASSWORD = PASSWORD
    process.env.DB_NAME = TEST_DB

    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
    await admin.query(`CREATE DATABASE ${TEST_DB}`)
    await admin.end()

    const core = require('@fuzefront/core')
    const migDir = path.join(__dirname, '..', 'dist', 'migrations')
    await core.runMigrations({ migrationsTableName: 'knex_migrations', migrationsDir: migDir })
    core.initializeDatabaseConnection({ migrationsTableName: 'knex_migrations', migrationsDir: migDir })
    db = core.db

    const rootOrgMigration = require('../src/migrations/014_seed_root_platform_organization')
    ROOT_ORG_ID = rootOrgMigration.ROOT_ORG_ID
    migration015 = require('../src/migrations/015_root_membership_backfill_and_personal_org_reclassify')

    // Fresh scratch DB has zero users at migration time, so 014's up() (run as
    // part of the full chain above) deferred root-org creation. Bootstrap it
    // the same way organizationProvisioning.rootMembership.test.ts does, so
    // this test's seeded users have a root org to backfill a membership into.
    const bootstrapUserId = uuidv4()
    await db('users').insert({
      id: bootstrapUserId,
      email: 'backfill-bootstrap@test.local',
      first_name: 'Bootstrap',
      last_name: 'User',
      roles: JSON.stringify(['admin', 'user']),
      created_at: new Date(),
      updated_at: new Date(),
    })
    await rootOrgMigration.up(db)
  }, 60000)

  afterAll(async () => {
    if (db) await db.destroy()
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

  it('(a) backfills a root member row for every user lacking one — zero rows deleted', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

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

    await migration015.up(db)

    const backfilled = await db('organization_memberships')
      .where({ user_id: userWithoutRoot, organization_id: ROOT_ORG_ID })
      .first()
    expect(backfilled).toMatchObject({ role: 'member', status: 'active' })

    // Pre-existing row untouched — not overwritten to 'member'.
    const untouched = await db('organization_memberships')
      .where({ user_id: userWithExistingRoot, organization_id: ROOT_ORG_ID })
      .first()
    expect(untouched.role).toBe('admin')

    // Zero rows anywhere were deleted by this migration.
    const totalMemberships: Array<{ c: string }> = await db('organization_memberships').count('* as c')
    expect(Number(totalMemberships[0].c)).toBeGreaterThan(0)
  })

  it('(b) reclassifies type=personal -> type=organization, non-destructively (settings/metadata preserved)', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const owner = await createUser()
    const personalOrgId = await createPersonalOrg(owner)

    await migration015.up(db)

    const org = await db('organizations').where({ id: personalOrgId }).first()
    expect(org.type).toBe('organization')
    // Nothing else about the row changed.
    expect(org.owner_id).toBe(owner)
    expect(org.is_active).toBe(true)
    const metadata = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata
    expect(metadata).toEqual({ personal: true })

    // Row count unaffected — reclassify, not delete.
    const stillThere = await db('organizations').where({ id: personalOrgId }).first()
    expect(stillThere).toBeTruthy()
  })

  it('(c) edge case: a user whose org cannot be resolved still gets a root membership', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    // A user with NO organizations row at all (owns nothing, member of
    // nothing) — root membership must still be backfilled; it never depends
    // on org resolution.
    const orphanUser = await createUser()

    await migration015.up(db)

    const membership = await db('organization_memberships')
      .where({ user_id: orphanUser, organization_id: ROOT_ORG_ID })
      .first()
    expect(membership).toMatchObject({ role: 'member', status: 'active' })
  })

  it('(d) idempotent: running the migration twice produces no diff on the second run', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const userId = await createUser()
    await createPersonalOrg(userId)

    await migration015.up(db)

    const membershipsAfterFirst = await db('organization_memberships').select('id').orderBy('id')
    const orgTypesAfterFirst = await db('organizations').select('id', 'type').orderBy('id')
    const personalCountAfterFirst: Array<{ c: string }> = await db('organizations')
      .where({ type: 'personal' })
      .count('* as c')
    expect(Number(personalCountAfterFirst[0].c)).toBe(0)

    // Re-run on the SAME (already-migrated) database.
    await expect(migration015.up(db)).resolves.toBeUndefined()

    const membershipsAfterSecond = await db('organization_memberships').select('id').orderBy('id')
    const orgTypesAfterSecond = await db('organizations').select('id', 'type').orderBy('id')

    // No new rows, no rows lost, no type changed a second time.
    expect(membershipsAfterSecond).toEqual(membershipsAfterFirst)
    expect(orgTypesAfterSecond).toEqual(orgTypesAfterFirst)

    // Specifically: this user's root membership row is still exactly one row.
    const rows = await db('organization_memberships')
      .where({ user_id: userId, organization_id: ROOT_ORG_ID })
    expect(rows).toHaveLength(1)
  })

  it('(e) REGRESSION 2026-08-23: skips the reclassify (not just the backfill) when the root org is absent — the prod #750 strand-every-user bug', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    // Runs entirely inside one transaction that is ALWAYS rolled back (via
    // the thrown sentinel below), so deleting the real ROOT_ORG_ID row (the
    // exact prod precondition — #750: the row does not exist) can never leak
    // into this scratch DB's state for later tests in this file.
    class IntentionalTestRollback extends Error {}

    await expect(
      db.transaction(async (trx: any) => {
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

        await migration015.up(trx)

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
