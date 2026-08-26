/**
 * Real-DB integration test proving migration 017 (forward repair for the
 * 2026-08-23 personal-org over-reclassification incident) restores affected
 * rows, is idempotent, and never destroys a duplicate org that has real
 * content. Mirrors `migrations.rootMembershipBackfill.test.ts`'s
 * reachability-skip pattern (own scratch DB, skips gracefully when Postgres
 * is unreachable so unit CI without a DB still passes) and monolith copy
 * `backend/tests/personalOrgOverReclassificationRepairMigration.test.ts`.
 */
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Client } from 'pg'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_personal_org_repair_test'

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

describe('migration 017 — personal-org over-reclassification repair (2026-08-23 incident, security service, integration)', () => {
  let reachable = false
  let db: any
  let migration017: { up(knex: any): Promise<void>; down(knex: any): Promise<void> }

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

    migration017 = require('../src/migrations/017_repair_personal_org_over_reclassification')
  }, 60000)

  afterAll(async () => {
    if (db) await db.destroy()
  })

  async function createUser(): Promise<string> {
    const id = uuidv4()
    await db('users').insert({
      id,
      email: `repair-${id.slice(0, 8)}@test.local`,
      first_name: 'Repair',
      last_name: 'Test',
      roles: JSON.stringify(['user']),
      created_at: new Date(),
      updated_at: new Date(),
    })
    return id
  }

  async function createDamagedPersonalOrg(
    ownerId: string,
    opts: { slug?: string } = {}
  ): Promise<string> {
    const id = uuidv4()
    await db('organizations').insert({
      id,
      name: 'Personal',
      slug: opts.slug ?? `personal-${id.slice(0, 8)}`,
      owner_id: ownerId,
      type: 'organization', // <-- incorrectly reclassified
      settings: JSON.stringify({}),
      metadata: JSON.stringify({ personal: true }),
      is_active: true,
      provisioning_state: 'pending',
    })
    return id
  }

  async function createLegitimateOrg(ownerId: string): Promise<string> {
    const id = uuidv4()
    await db('organizations').insert({
      id,
      name: 'Acme Inc',
      slug: `acme-${id.slice(0, 8)}`,
      owner_id: ownerId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'pending',
    })
    return id
  }

  async function insertOwnerMembership(orgId: string, ownerId: string): Promise<void> {
    await db('organization_memberships').insert({
      id: uuidv4(),
      user_id: ownerId,
      organization_id: orgId,
      role: 'owner',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
    })
  }

  it('restores a reclassified row back to type=personal, non-destructively', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const owner = await createUser()
    const orgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(orgId, owner)

    await migration017.up(db)

    const org = await db('organizations').where({ id: orgId }).first()
    expect(org.type).toBe('personal')
    expect(org.owner_id).toBe(owner)
    expect(org.is_active).toBe(true)
    const metadata =
      typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata
    expect(metadata).toEqual({ personal: true })
  })

  it('does not touch a legitimate organization that never carried the personal stamp', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const owner = await createUser()
    const orgId = await createLegitimateOrg(owner)

    await migration017.up(db)

    const org = await db('organizations').where({ id: orgId }).first()
    expect(org.type).toBe('organization')
  })

  it('is idempotent: running it twice produces no diff on the second run', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const owner = await createUser()
    const orgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(orgId, owner)

    await migration017.up(db)
    const afterFirst = await db('organizations').where({ id: orgId }).first()
    expect(afterFirst.type).toBe('personal')

    await expect(migration017.up(db)).resolves.toBeUndefined()

    const afterSecond = await db('organizations').where({ id: orgId }).first()
    expect(afterSecond.type).toBe('personal')
    expect(afterSecond.updated_at.getTime()).toBe(afterFirst.updated_at.getTime())
  })

  it('removes an EMPTY duplicate personal org to make way for the restore', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const owner = await createUser()
    const damagedOrgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(damagedOrgId, owner)

    const duplicateId = uuidv4()
    await db('organizations').insert({
      id: duplicateId,
      name: 'Personal',
      slug: `personal-dup-${duplicateId.slice(0, 8)}`,
      owner_id: owner,
      type: 'personal',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({ personal: true }),
      is_active: true,
      provisioning_state: 'pending',
    })
    await insertOwnerMembership(duplicateId, owner)

    await migration017.up(db)

    const restored = await db('organizations').where({ id: damagedOrgId }).first()
    expect(restored.type).toBe('personal')

    const duplicate = await db('organizations').where({ id: duplicateId }).first()
    expect(duplicate).toBeUndefined() // removed
  })

  it('REFUSES to remove a duplicate that has content — skips the restore instead', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')

    const owner = await createUser()
    const otherMember = await createUser()
    const damagedOrgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(damagedOrgId, owner)

    const duplicateId = uuidv4()
    await db('organizations').insert({
      id: duplicateId,
      name: 'Personal',
      slug: `personal-content-${duplicateId.slice(0, 8)}`,
      owner_id: owner,
      type: 'personal',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({ personal: true }),
      is_active: true,
      provisioning_state: 'pending',
    })
    await insertOwnerMembership(duplicateId, owner)
    await db('organization_memberships').insert({
      id: uuidv4(),
      user_id: otherMember,
      organization_id: duplicateId,
      role: 'member',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
    })

    await migration017.up(db)

    const damaged = await db('organizations').where({ id: damagedOrgId }).first()
    expect(damaged.type).toBe('organization')

    const duplicate = await db('organizations').where({ id: duplicateId }).first()
    expect(duplicate).toBeDefined()
    expect(duplicate.type).toBe('personal')
  })
})
