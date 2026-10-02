/**
 * FF-EPIC-17 — real-DB integration test proving migration 019 (set root owner +
 * backfill root memberships) is correct, idempotent, and safe. Security-service
 * copy of `backend/tests/setRootOwnerAndBackfillMigration.test.ts`.
 *
 * Mirrors migrations.rootMembershipBackfill.test.ts's reachability-skip pattern
 * (own scratch DB; skips when no Postgres so unit CI without a DB still passes).
 * Each scenario runs inside an always-rolled-back transaction so the scratch DB
 * stays clean between cases. `ROOT_OWNER_EMAIL` is pinned per-test.
 */
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Client } from 'pg'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_root_owner_test'

class IntentionalTestRollback extends Error {}

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

describe('migration 019 — set root owner + backfill memberships (FF-EPIC-17, #750, integration)', () => {
  let reachable = false
  let db: any
  let ROOT_ORG_ID: string
  let migration019: { up(knex: any): Promise<void>; down(knex: any): Promise<void> }

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
    migration019 = require('../src/migrations/019_set_root_owner_and_backfill_memberships')

    // Fresh scratch DB had zero users at migration time (014 deferred root
    // creation); bootstrap a user + the root org so scenarios have a baseline.
    const bootstrapUserId = uuidv4()
    await db('users').insert({
      id: bootstrapUserId,
      email: 'root-owner-bootstrap@test.local',
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

  afterEach(() => {
    delete process.env.ROOT_OWNER_EMAIL
  })

  async function insertUser(trx: any, email: string): Promise<string> {
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

  async function inRollback(body: (trx: any) => Promise<void>): Promise<void> {
    await expect(
      db.transaction(async (trx: any) => {
        await body(trx)
        throw new IntentionalTestRollback('discard — never persist scenario mutations')
      }),
    ).rejects.toThrow(IntentionalTestRollback)
  }

  const guard = () => {
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn('[skip] Postgres not reachable — set-root-owner integration test skipped')
      return true
    }
    return false
  }

  it('sets owner_id + owner membership on root, and backfills members for everyone else', async () => {
    if (guard()) return
    const ownerEmail = `root-owner-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)
      const otherId = await insertUser(trx, `other-${uuidv4().slice(0, 8)}@test.local`)

      await migration019.up(trx)

      const root = await trx('organizations').where({ id: ROOT_ORG_ID }).first()
      expect(root.owner_id).toBe(ownerId)

      const ownerMembership = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
        .first()
      expect(ownerMembership.role).toBe('owner')

      const otherMembership = await trx('organization_memberships')
        .where({ user_id: otherId, organization_id: ROOT_ORG_ID })
        .first()
      expect(otherMembership.role).toBe('member')
    })
  })

  it('upgrades a stale non-owner membership for the owner to owner', async () => {
    if (guard()) return
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

      await migration019.up(trx)

      const rows = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0].role).toBe('owner')
    })
  })

  it('is idempotent: a second run does not duplicate or downgrade', async () => {
    if (guard()) return
    const ownerEmail = `root-idem-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)

      await migration019.up(trx)
      await migration019.up(trx)

      const rows = await trx('organization_memberships')
        .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0].role).toBe('owner')
      expect((await trx('organizations').where({ id: ROOT_ORG_ID }).first()).owner_id).toBe(ownerId)
    })
  })

  it('SAFE-SKIP: does nothing (no throw, no create) when the root org is absent', async () => {
    if (guard()) return
    const ownerEmail = `root-absent-${uuidv4().slice(0, 8)}@test.local`
    process.env.ROOT_OWNER_EMAIL = ownerEmail

    await inRollback(async trx => {
      const ownerId = await insertUser(trx, ownerEmail)
      await trx('organizations').where({ id: ROOT_ORG_ID }).del()

      await migration019.up(trx) // must not throw

      expect(await trx('organizations').where({ id: ROOT_ORG_ID }).first()).toBeUndefined()
      expect(
        await trx('organization_memberships')
          .where({ user_id: ownerId, organization_id: ROOT_ORG_ID })
          .first(),
      ).toBeUndefined()
    })
  })
})
