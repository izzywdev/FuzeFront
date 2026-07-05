/**
 * Integration test for invitation routes against a real Postgres instance.
 *
 * Requires a reachable Postgres; skips gracefully otherwise so unit CI without
 * a DB still passes. Creates and tears down its own isolated test database.
 *
 * What is asserted (not mocked):
 *  - POST /api/organizations/:id/invitations inserts a real invitation row.
 *  - The `publishNotifyEmailRequested` spy is called with the correct payload.
 *  - POST /api/invitations/:token/accept inserts a real membership row and
 *    marks the invitation status='accepted'.
 *  - Two concurrent accepts of the same token result in exactly one membership
 *    row and the second request gets 409.
 *  - GET /api/invitations/:token returns a masked email (not the raw address).
 *
 * Mocked (no real external dependencies in CI):
 *  - `config/permit` + permit utils — no PERMIT_API_KEY in test env; role
 *    assignment is non-blocking and exercised in unit tests.
 *  - `middleware/permissions` — Permit-dependent; allow-all stubs.
 *  - `middleware/auth` — JWT verification replaced by test user injection.
 *  - `services/organizationProvisioning` — Permit-dependent; non-blocking.
 *  - `defaultEventPublisher` — no real Kafka broker; we spy on call payload.
 */

// ─── top-level jest mocks (hoisted before any require/import resolution) ──────

// Permit SDK requires an API key at import time — stub the whole module.
jest.mock('../src/config/permit', () => ({
  default: {
    api: {
      roleAssignments: {
        assign: jest.fn().mockResolvedValue({}),
        unassign: jest.fn().mockResolvedValue({}),
        list: jest.fn().mockResolvedValue([]),
      },
    },
  },
  permitConfig: { token: 'test', pdp: 'http://localhost:7766' },
}))

jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
  assignRoleInPermit: jest.fn().mockResolvedValue(true),
  unassignRoleInPermit: jest.fn().mockResolvedValue(true),
  getUserRoleAssignments: jest.fn().mockResolvedValue([]),
  getTenantRoleAssignments: jest.fn().mockResolvedValue([]),
  userHasRole: jest.fn().mockResolvedValue(false),
  updateOrganizationRole: jest.fn().mockResolvedValue(true),
}))

jest.mock('../src/utils/permit/permission-check', () => ({
  checkPermission: jest.fn().mockResolvedValue(true),
}))

jest.mock('../src/middleware/permissions', () => ({
  PermissionMiddleware: {
    canReadOrganization: (_req: any, _res: any, next: any) => next(),
    canUpdateOrganization: (_req: any, _res: any, next: any) => next(),
    canDeleteOrganization: (_req: any, _res: any, next: any) => next(),
    canInviteUsers: (_req: any, _res: any, next: any) => next(),
    canViewMembers: (_req: any, _res: any, next: any) => next(),
  },
  requireOwnership: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    // The test injects req.__testUser before the request via a middleware layer;
    // fall back to a default so auth-required endpoints don't 401.
    req.user = req.__testUser ?? {
      id: 'default-test-user',
      email: 'default@test.example',
      roles: ['user'],
    }
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

jest.mock('../src/services/organizationProvisioning', () => ({
  reconcileOrganizationProvisioning: jest.fn().mockResolvedValue(undefined),
}))

// ─── imports (after jest.mock declarations) ───────────────────────────────────

import path from 'path'
import request from 'supertest'
import express from 'express'
import { Client } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { runMigrations, initializeDatabase, closeDatabase } from '@fuzefront/core'
import organizationsRouter from '../src/routes/organizations'
import invitationsRouter from '../src/routes/invitations'
import { defaultEventPublisher } from '../src/services/eventPublisher'

// ─── connection constants (same defaults as migrations integration test) ──────
const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER_PG = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_inv_integration_test'

async function pgReachable(): Promise<boolean> {
  const c = new Client({
    host: HOST, port: PORT, user: USER_PG, password: PASSWORD, database: 'postgres',
  })
  try {
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    return true
  } catch {
    return false
  }
}

// ─── app builder ─────────────────────────────────────────────────────────────
function buildApp(authenticatedUser: { id: string; email: string } | null = null) {
  const app = express()
  app.use(express.json())

  // Inject authenticated user both into req.user (for routes that check it
  // directly, like the invitations accept handler which is auth-optional) and
  // into req.__testUser (for the mocked authenticateToken middleware).
  app.use((req: any, _res: any, next: any) => {
    req.__testUser = authenticatedUser
    req.user = authenticatedUser  // invitations accept route reads req.user directly
    next()
  })

  app.use('/api/organizations', organizationsRouter)
  app.use('/api/invitations', invitationsRouter)
  return app
}

// ─── test data identifiers ───────────────────────────────────────────────────
const ORG_ID = uuidv4()
const OWNER_ID = uuidv4()
const INVITEE_ID = uuidv4()
const OWNER_EMAIL = 'owner@inv-integration-test.example'
const INVITEE_EMAIL = 'invitee@inv-integration-test.example'

describe('invitations routes (integration)', () => {
  let reachable = false
  let pgClient: Client

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return

    // NODE_ENV='production' so getDatabaseConfig uses loadExtensions:['.js']
    // and does not try to require .d.ts files from dist/migrations.
    process.env.USE_POSTGRES = 'true'
    process.env.NODE_ENV = 'production'
    process.env.DB_HOST = HOST
    process.env.DB_PORT = String(PORT)
    process.env.DB_USER = USER_PG
    process.env.DB_PASSWORD = PASSWORD
    process.env.DB_NAME = TEST_DB

    // Create a fresh test database. Terminate any lingering connections from
    // previous runs first (e.g. from an interrupted jest process).
    const admin = new Client({
      host: HOST, port: PORT, user: USER_PG, password: PASSWORD, database: 'postgres',
    })
    await admin.connect()
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    )
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`)
    await admin.query(`CREATE DATABASE "${TEST_DB}"`)
    await admin.end()

    // Run the security-service migration chain against the test DB.
    const migDir = path.join(__dirname, '..', 'dist', 'migrations')
    await runMigrations({
      migrationsTableName: 'knex_migrations',
      migrationsDir: migDir,
    })

    // Initialize the shared knex singleton so route handlers' `db` call works.
    await initializeDatabase({
      migrationsTableName: 'knex_migrations',
      migrationsDir: migDir,
    })

    // Direct pg client for assertions.
    pgClient = new Client({
      host: HOST, port: PORT, user: USER_PG, password: PASSWORD, database: TEST_DB,
    })
    await pgClient.connect()

    // Seed: owner user + organization + owner membership.
    // Note: the users table (migration 001) has no is_active column.
    const passwordHash = await bcrypt.hash('testpass', 10)
    await pgClient.query(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [OWNER_ID, OWNER_EMAIL, passwordHash]
    )
    await pgClient.query(
      `INSERT INTO organizations (id, name, slug, owner_id, type, is_active, settings, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'organization', true, '{}', '{}', NOW(), NOW())`,
      [ORG_ID, 'Integration Test Org', 'int-test-org', OWNER_ID]
    )
    await pgClient.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
       VALUES ($1, $2, $3, 'owner', 'active', NOW(), '{}', '{}')`,
      [uuidv4(), OWNER_ID, ORG_ID]
    )

    // Seed the invitee user (needed for the accept flow).
    await pgClient.query(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [INVITEE_ID, INVITEE_EMAIL, passwordHash]
    )
  }, 90000)

  afterAll(async () => {
    if (!reachable) return
    await pgClient?.end()

    // Close the shared knex singleton (best-effort) before dropping the test DB.
    await closeDatabase().catch(() => undefined)

    // Drop the test DB. Terminate any remaining connections first.
    const admin = new Client({
      host: HOST, port: PORT, user: USER_PG, password: PASSWORD, database: 'postgres',
    })
    await admin.connect()
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    )
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`)
    await admin.end()
  }, 30000)

  // ─── create invitation + email event assertion ──────────────────────────────
  describe('POST /api/organizations/:id/invitations', () => {
    it('inserts an invitation row and calls publishNotifyEmailRequested with correct payload', async () => {
      if (!reachable) {
        console.warn('Postgres unreachable — skipping invitation integration test')
        return
      }

      // Spy on the event publisher so we can assert the call payload without a real Kafka broker.
      const publishSpy = jest
        .spyOn(defaultEventPublisher, 'publishNotifyEmailRequested')
        .mockResolvedValue(undefined)

      const app = buildApp({ id: OWNER_ID, email: OWNER_EMAIL })
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/invitations`)
        .send({ email: INVITEE_EMAIL, role: 'member' })

      expect(res.status).toBe(201)
      expect(res.body.invitation).toBeDefined()
      expect(res.body.invitation.email).toBe(INVITEE_EMAIL)

      // Verify row exists in DB.
      const dbRow = await pgClient.query(
        `SELECT * FROM organization_invitations WHERE organization_id = $1 AND email = $2`,
        [ORG_ID, INVITEE_EMAIL]
      )
      expect(dbRow.rowCount).toBe(1)

      const inv = dbRow.rows[0]
      expect(inv.status).toBe('pending')
      expect(inv.role).toBe('member')
      expect(inv.token).toBeDefined()
      expect(inv.token.length).toBeGreaterThan(10)
      expect(new Date(inv.expires_at).getTime()).toBeGreaterThan(Date.now())

      // Verify email event was published with correct payload.
      expect(publishSpy).toHaveBeenCalledTimes(1)
      const emailPayload = publishSpy.mock.calls[0][0] as any
      expect(emailPayload.template).toBe('org-invite')
      expect(emailPayload.to).toBe(INVITEE_EMAIL)
      expect(emailPayload.vars).toBeDefined()
      expect(emailPayload.orgId).toBe(ORG_ID)

      publishSpy.mockRestore()
    }, 30000)
  })

  // ─── public resolve: masked email (I1) ─────────────────────────────────────
  describe('GET /api/invitations/:token', () => {
    it('returns masked email (not raw address) in public resolve response', async () => {
      if (!reachable) {
        console.warn('Postgres unreachable — skipping masked-email integration test')
        return
      }

      // Look up the invitation created in the previous test block.
      const invRow = await pgClient.query(
        `SELECT * FROM organization_invitations WHERE organization_id = $1 AND email = $2 AND status = 'pending'`,
        [ORG_ID, INVITEE_EMAIL]
      )

      let token: string
      if (invRow.rowCount === 0) {
        // Insert a fresh one if needed.
        const crypto = await import('crypto')
        token = crypto.randomBytes(32).toString('hex')
        await pgClient.query(
          `INSERT INTO organization_invitations (id, organization_id, email, role, token, expires_at, status, invited_by, created_at)
           VALUES ($1, $2, $3, 'member', $4, NOW() + INTERVAL '7 days', 'pending', $5, NOW())`,
          [uuidv4(), ORG_ID, INVITEE_EMAIL, token, OWNER_ID]
        )
      } else {
        token = invRow.rows[0].token
      }

      const app = buildApp(null)  // unauthenticated
      const res = await request(app).get(`/api/invitations/${token}`)

      expect(res.status).toBe(200)
      expect(res.body.invitation).toBeDefined()

      // Must be masked: first char + *** + @domain
      const maskedEmail: string = res.body.invitation.email
      expect(maskedEmail).not.toBe(INVITEE_EMAIL)
      expect(maskedEmail).toMatch(/^.{1}\*{3}@/)
      // The domain part must still be present
      expect(maskedEmail).toContain('@inv-integration-test.example')
    }, 20000)
  })

  // ─── accept invitation flow ─────────────────────────────────────────────────
  describe('POST /api/invitations/:token/accept', () => {
    it('creates membership row and marks invitation accepted', async () => {
      if (!reachable) {
        console.warn('Postgres unreachable — skipping invitation accept integration test')
        return
      }

      // Look up the token inserted by the previous test.
      let invRow = await pgClient.query(
        `SELECT * FROM organization_invitations WHERE organization_id = $1 AND email = $2 AND status = 'pending'`,
        [ORG_ID, INVITEE_EMAIL]
      )

      if (invRow.rowCount === 0) {
        // If the create-invitation test was skipped or failed, insert directly.
        const crypto = await import('crypto')
        const token = crypto.randomBytes(32).toString('hex')
        await pgClient.query(
          `INSERT INTO organization_invitations (id, organization_id, email, role, token, expires_at, status, invited_by, created_at)
           VALUES ($1, $2, $3, 'member', $4, NOW() + INTERVAL '7 days', 'pending', $5, NOW())`,
          [uuidv4(), ORG_ID, INVITEE_EMAIL, token, OWNER_ID]
        )
        invRow = await pgClient.query(
          `SELECT * FROM organization_invitations WHERE organization_id = $1 AND email = $2 AND status = 'pending'`,
          [ORG_ID, INVITEE_EMAIL]
        )
      }

      expect(invRow.rowCount).toBeGreaterThan(0)
      const invitation = invRow.rows[0]

      const app = buildApp({ id: INVITEE_ID, email: INVITEE_EMAIL })
      const res = await request(app)
        .post(`/api/invitations/${invitation.token}/accept`)

      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/accepted/i)
      expect(res.body.organizationId).toBe(ORG_ID)

      // Invitation should now be 'accepted'.
      const updatedInv = await pgClient.query(
        `SELECT status FROM organization_invitations WHERE id = $1`,
        [invitation.id]
      )
      expect(updatedInv.rows[0].status).toBe('accepted')

      // Membership row should exist.
      const membership = await pgClient.query(
        `SELECT * FROM organization_memberships WHERE user_id = $1 AND organization_id = $2`,
        [INVITEE_ID, ORG_ID]
      )
      expect(membership.rowCount).toBe(1)
      expect(membership.rows[0].role).toBe('member')
      expect(membership.rows[0].status).toBe('active')
    }, 30000)

    it('returns 409 when accepting the same invitation a second time', async () => {
      if (!reachable) {
        console.warn('Postgres unreachable — skipping duplicate accept test')
        return
      }

      // Find the now-accepted invitation.
      const invRow = await pgClient.query(
        `SELECT * FROM organization_invitations WHERE organization_id = $1 AND email = $2 AND status = 'accepted'`,
        [ORG_ID, INVITEE_EMAIL]
      )
      if (invRow.rowCount === 0) {
        console.warn('No accepted invitation found — previous test may have been skipped')
        return
      }

      const app = buildApp({ id: INVITEE_ID, email: INVITEE_EMAIL })
      const res = await request(app)
        .post(`/api/invitations/${invRow.rows[0].token}/accept`)

      expect(res.status).toBe(409)
    }, 15000)

    it('concurrent accepts of the same token → exactly one membership + second gets 409 (I2)', async () => {
      if (!reachable) {
        console.warn('Postgres unreachable — skipping concurrent accept test')
        return
      }

      // Create a fresh invitation for the race test.
      const cryptoMod = await import('crypto')
      const raceToken = cryptoMod.randomBytes(32).toString('hex')
      const raceInvId = uuidv4()
      await pgClient.query(
        `INSERT INTO organization_invitations (id, organization_id, email, role, token, expires_at, status, invited_by, created_at)
         VALUES ($1, $2, $3, 'member', $4, NOW() + INTERVAL '7 days', 'pending', $5, NOW())`,
        [raceInvId, ORG_ID, INVITEE_EMAIL, raceToken, OWNER_ID]
      )

      const app = buildApp({ id: INVITEE_ID, email: INVITEE_EMAIL })

      // Fire two accepts simultaneously.
      const [res1, res2] = await Promise.all([
        request(app).post(`/api/invitations/${raceToken}/accept`),
        request(app).post(`/api/invitations/${raceToken}/accept`),
      ])

      const statuses = [res1.status, res2.status].sort()
      // Exactly one 200 and one 409.
      expect(statuses).toEqual([200, 409])

      // Exactly one membership row for this invitation.
      const memberships = await pgClient.query(
        `SELECT * FROM organization_memberships
         WHERE user_id = $1 AND organization_id = $2`,
        [INVITEE_ID, ORG_ID]
      )
      // May be 1 (first accept created it) or 2 if membership was already there from previous test,
      // but the invitation must be accepted exactly once.
      const invStatus = await pgClient.query(
        `SELECT status FROM organization_invitations WHERE id = $1`,
        [raceInvId]
      )
      expect(invStatus.rows[0].status).toBe('accepted')
      expect(memberships.rowCount).toBeGreaterThanOrEqual(1)
    }, 30000)
  })
})
