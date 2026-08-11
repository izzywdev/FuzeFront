/**
 * FF-EPIC-17-S1 — real-DB integration test for the `fuzefront.identity.
 * root-membership` provisioning branch in organizationProvisioning.ts.
 *
 * Mirrors backend/tests/provisioning.test.ts (monolith)'s "real Postgres,
 * fake Permit" style, combined with THIS service's
 * tests/migrations.integration.test.ts reachability-skip pattern (own scratch
 * DB, skips gracefully — no `beforeAll` throw — when Postgres is
 * unreachable, so unit CI without a DB still passes).
 *
 * Exercises BOTH flag states per the `feature-flags` skill's "test BOTH
 * states" rule:
 *   - OFF (default): today's personal-org behavior, byte-identical, zero
 *     regression, no root membership row created as a side effect.
 *   - ON: root-org `member` upsert, idempotent, no personal org created,
 *     `assignOrganizationRole` called so Permit's tenant role tracks it.
 */
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Client } from 'pg'

// Avoid importing the real Permit SDK. `ensureRootMembership` calls
// `assignOrganizationRole` directly (not through the injectable
// `ProvisioningDeps.permit`), so it must be mocked at the module boundary —
// mirrors organizations.members.test.ts's mock of the same module.
jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
}))

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_root_membership_test'

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

describe('organizationProvisioning — root membership (FF-EPIC-17-S1, integration)', () => {
  let reachable = false

  // Populated in beforeAll once we know Postgres is reachable — every `it`
  // guards on `reachable` first, exactly like migrations.integration.test.ts.
  let db: any
  let ensurePersonalOrg: any
  let ensureRootMembership: any
  let runInternalProvision: any
  let ROOT_ORG_ID: string
  let isRootMembershipEnabled: jest.SpyInstance
  let rootMembershipFlagModule: any
  let assignOrganizationRoleMock: jest.Mock

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return

    process.env.USE_POSTGRES = 'true'
    process.env.NODE_ENV = 'production' // run compiled .js migrations from dist
    process.env.DB_HOST = HOST
    process.env.DB_PORT = String(PORT)
    process.env.DB_USER = USER
    process.env.DB_PASSWORD = PASSWORD
    process.env.DB_NAME = TEST_DB
    // `organizationProvisioning.ts` imports permit/tenant-management.ts and
    // permit/user-sync.ts at module load — both pull in config/permit.ts,
    // which throws at import time without a token. The well-known CI dummy
    // key switches it to a zero-network no-op proxy (see config/permit.ts).
    process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

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

    ;({
      ensurePersonalOrg,
      ensureRootMembership,
      runInternalProvision,
    } = require('../src/services/organizationProvisioning'))
    const rootOrgMigration = require('../src/migrations/014_seed_root_platform_organization')
    ROOT_ORG_ID = rootOrgMigration.ROOT_ORG_ID
    rootMembershipFlagModule = require('../src/utils/rootMembershipFlag')
    assignOrganizationRoleMock = require('../src/utils/permit/role-assignment')
      .assignOrganizationRole as jest.Mock

    // On a truly fresh scratch DB (zero users at migration time — this test's
    // own scratch DB, not a real deployment where the monolith's migration or
    // the seeded platform-registrar already provides an owner), migration
    // 014's `up()` legitimately DEFERS root-org creation ("no users yet")
    // exactly like the monolith's ensureRootPortal() self-heal. Reproduce that
    // self-heal here: create a bootstrap user, then re-run 014's `up()`
    // directly — this is the same "self-heals on a later boot" path a real
    // deployment relies on, not a test-only shortcut.
    const bootstrapUserId = uuidv4()
    await db('users').insert({
      id: bootstrapUserId,
      email: 'bootstrap@test.local',
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

  beforeEach(() => {
    if (!reachable) return
    jest.clearAllMocks()
    isRootMembershipEnabled = jest.spyOn(rootMembershipFlagModule, 'isRootMembershipEnabled')
  })

  afterEach(() => {
    if (isRootMembershipEnabled) isRootMembershipEnabled.mockRestore()
  })

  async function createUser(): Promise<string> {
    const id = uuidv4()
    await db('users').insert({
      id,
      email: `root-mem-${id.slice(0, 8)}@test.local`,
      first_name: 'Root',
      last_name: 'Mem',
      roles: JSON.stringify(['user']),
      created_at: new Date(),
      updated_at: new Date(),
    })
    return id
  }

  function fakePermitDeps() {
    return {
      db,
      permit: {
        async syncUser() {},
        async createTenant() {},
        async assignOwnerRole() {},
      },
      publish: {
        async publishIdentityUserCreated() {},
        async publishNotifyEmailRequested() {},
      },
    }
  }

  it('sanity: root org (ROOT_ORG_ID) exists — seeded by migration 014/015', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')
    const root = await db('organizations').where({ id: ROOT_ORG_ID }).first()
    expect(root).toBeTruthy()
  })

  describe('flag OFF (default) — byte-identical to today', () => {
    it('runInternalProvision still creates a personal org and returns its id', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      isRootMembershipEnabled.mockResolvedValue(false)

      const userId = await createUser()
      const result = await runInternalProvision(userId, fakePermitDeps())

      expect(result.personalOrgId).toBeTruthy()
      const personal = await db('organizations').where({ id: result.personalOrgId }).first()
      expect(personal.type).toBe('personal')

      // No root-org membership row was created as a side effect of the OFF path.
      const rootMembership = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
        .first()
      expect(rootMembership).toBeUndefined()
    })
  })

  describe('flag ON — root membership, no personal org', () => {
    it('runInternalProvision upserts a root member row and creates NO personal org', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      isRootMembershipEnabled.mockResolvedValue(true)

      const userId = await createUser()
      const result = await runInternalProvision(userId, fakePermitDeps())

      expect(result.personalOrgId).toBeNull()

      const personalOrgs = await db('organizations').where({ owner_id: userId, type: 'personal' })
      expect(personalOrgs).toHaveLength(0)

      const membership = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
        .first()
      expect(membership).toMatchObject({ role: 'member', status: 'active' })

      // Permit tenant role assignment tracks the row.
      expect(assignOrganizationRoleMock).toHaveBeenCalledWith(userId, ROOT_ORG_ID, 'member')
    })

    it('ensureRootMembership is idempotent — two calls yield exactly one row', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      const userId = await createUser()

      await ensureRootMembership(userId, { db })
      await ensureRootMembership(userId, { db })

      const rows = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ role: 'member', status: 'active' })
    })

    it('concurrent ensureRootMembership calls yield exactly one row (race safety)', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      const userId = await createUser()

      await Promise.all([
        ensureRootMembership(userId, { db }),
        ensureRootMembership(userId, { db }),
      ])

      const rows = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
    })

    it('does not overwrite a pre-existing root membership with a different role', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      const userId = await createUser()
      await db('organization_memberships').insert({
        id: uuidv4(),
        user_id: userId,
        organization_id: ROOT_ORG_ID,
        role: 'admin',
        status: 'active',
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })

      await ensureRootMembership(userId, { db })

      const rows = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0].role).toBe('admin') // untouched, not downgraded to 'member'
    })

    it('login self-heal (runInternalProvision re-run) does not duplicate the root membership', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      isRootMembershipEnabled.mockResolvedValue(true)
      const userId = await createUser()

      await runInternalProvision(userId, fakePermitDeps())
      await runInternalProvision(userId, fakePermitDeps())

      const rows = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
    })
  })

  describe('flag ON does not disturb ensurePersonalOrg itself (direct callers unaffected)', () => {
    it('ensurePersonalOrg still creates a personal org when called directly, regardless of the flag', async () => {
      if (!reachable) return console.warn('Postgres unreachable — skipping')
      isRootMembershipEnabled.mockResolvedValue(true)
      const userId = await createUser()

      const personal = await ensurePersonalOrg(userId, { db })
      expect(personal.type).toBe('personal')
    })
  })
})
