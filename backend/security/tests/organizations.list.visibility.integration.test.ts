/**
 * Real-DB integration test for the owner-decided org-visibility filter on
 * GET /api/organizations (the list behind the shell's org switcher).
 *
 * Runs the REAL route handler + REAL SQL against a scratch Postgres database
 * (own database, minimal `organizations` / `organization_memberships` tables —
 * no migration chain needed). Skips when no Postgres is reachable, mirroring
 * tests/migrations.rootMembershipBackfill.test.ts, so DB-less unit CI still
 * passes.
 *
 * Hierarchy under test:
 *
 *   ROOT (type=platform)
 *   └── PORTAL
 *       └── ACME
 *           └── SALES
 *   OTHER (unrelated top-level org)
 *   PHANTOM (a second, legacy type=platform org — not the root)
 */
import request from 'supertest'
import express from 'express'
import { Client } from 'pg'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_orglist_visibility_test'

// `db` is swapped for a real knex instance in beforeAll; the jest.mock factory
// is hoisted, so route code reaches it through this indirection.
const holder: { db: any } = { db: null }

jest.mock('../src/config/database', () => {
  const proxy: any = (...args: any[]) => holder.db(...args)
  proxy.raw = (...args: any[]) => holder.db.raw(...args)
  proxy.transaction = (...args: any[]) => holder.db.transaction(...args)
  return { db: proxy }
})

// The pino logger pulls in @fuzefront/telemetry; stub it so this suite does not
// depend on that workspace package being built.
jest.mock('../src/lib/logger', () => {
  const log: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  log.child = () => log
  return { logger: log }
})

jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = req.__testUser
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
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

jest.mock('../src/services/organizationProvisioning', () => ({
  reconcileOrganizationProvisioning: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../src/utils/employeeFlag', () => ({
  EMPLOYEE_CONSOLE_FLAG: 'fuzefront.identity.employee-console',
  isEmployeeConsoleEnabled: jest.fn().mockResolvedValue(false),
}))

jest.mock('../src/utils/memberDirectoryFlag', () => ({
  MEMBER_DIRECTORY_FLAG: 'fuzefront.identity.member-directory',
  isMemberDirectoryEnabled: jest.fn().mockResolvedValue(true),
}))

jest.mock('../src/identity/flags', () => ({
  isPrefixedIdsEnabled: jest.fn().mockResolvedValue(false),
}))

// The kill-switch under test: default the mock to ON (the production default);
// the "kill-switch OFF" block flips it per test.
jest.mock('../src/utils/orgListDirectOnlyFlag', () => ({
  ORG_LIST_DIRECT_ONLY_FLAG: 'fuzefront.identity.org-list-direct-only-kill-switch',
  isOrgListDirectOnlyEnabled: jest.fn().mockResolvedValue(true),
}))

import { isOrgListDirectOnlyEnabled } from '../src/utils/orgListDirectOnlyFlag'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'
import organizationsRouter from '../src/routes/organizations'

const killSwitchMock = isOrgListDirectOnlyEnabled as jest.Mock

const id = (n: number) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`
const PORTAL = id(1)
const ACME = id(2)
const SALES = id(3)
const OTHER = id(4)
const PHANTOM = id(5)

const U_NORMAL = id(50) // root member + direct in ACME
const U_SKIP = id(51) // direct in PORTAL and SALES, NOT in ACME (middle ancestor)
const U_EMPLOYEE = id(52) // employee marker, root member + direct in ACME
const U_ROOT_ADMIN = id(53) // roles=['user'] but owner of root
const U_ROOT_ONLY = id(54) // only a baseline root membership
const U_NO_ROWS = id(55) // no membership rows at all
const U_DUP = id(56) // viewer + owner on ACME (FFRNT-378)
const U_SUSPENDED = id(57) // suspended membership on ACME
const U_PHANTOM = id(58) // direct member of the legacy type=platform org

let reachable = false
let knexDb: any

function buildApp(user: any) {
  const a = express()
  a.use(express.json())
  a.use((req: any, _res, next) => {
    req.__testUser = user
    next()
  })
  a.use('/api/organizations', organizationsRouter)
  return a
}

async function listFor(userId: string, roles: string[] = ['user'], query = '') {
  const res = await request(buildApp({ id: userId, email: `${userId}@example.com`, roles })).get(
    `/api/organizations${query}`
  )
  expect(res.status).toBe(200)
  return res.body as {
    organizations: Array<{ id: string; user_role: string | null }>
    pagination: { total: number }
  }
}

const ids = (body: { organizations: Array<{ id: string }> }) =>
  body.organizations.map(o => o.id).sort()

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

describe('GET /api/organizations — direct-membership-only visibility (integration)', () => {
  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return

    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
    await admin.query(`CREATE DATABASE ${TEST_DB}`)
    await admin.end()

    const knex = require('knex')
    knexDb = knex({
      client: 'pg',
      connection: { host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB },
      pool: { min: 0, max: 4 },
    })
    holder.db = knexDb

    await knexDb.raw(`
      CREATE TABLE organizations (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        slug text NOT NULL,
        parent_id uuid NULL,
        owner_id uuid NULL,
        type text NOT NULL DEFAULT 'organization',
        settings jsonb NOT NULL DEFAULT '{}',
        metadata jsonb NOT NULL DEFAULT '{}',
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE organization_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id),
        role text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        UNIQUE (user_id, organization_id, role)
      );
    `)

    const org = (oid: string, name: string, parent: string | null, type = 'organization') => ({
      id: oid,
      name,
      slug: name.toLowerCase(),
      parent_id: parent,
      type,
    })
    await knexDb('organizations').insert([
      org(ROOT_ORG_ID, 'FuzeFront', null, 'platform'),
      org(PORTAL, 'Portal', ROOT_ORG_ID),
      org(ACME, 'Acme', PORTAL),
      org(SALES, 'Sales', ACME),
      org(OTHER, 'Other', null),
      org(PHANTOM, 'Phantom', null, 'platform'),
    ])

    const m = (user: string, org: string, role: string, status = 'active') => ({
      user_id: user,
      organization_id: org,
      role,
      status,
    })
    await knexDb('organization_memberships').insert([
      // every user got a baseline `member` row on root (root-membership)
      ...[U_NORMAL, U_SKIP, U_EMPLOYEE, U_ROOT_ONLY, U_DUP, U_SUSPENDED, U_PHANTOM].map(u =>
        m(u, ROOT_ORG_ID, 'member')
      ),
      m(U_NORMAL, ACME, 'admin'),
      m(U_SKIP, PORTAL, 'member'),
      m(U_SKIP, SALES, 'viewer'),
      m(U_EMPLOYEE, ACME, 'member'),
      m(U_ROOT_ADMIN, ROOT_ORG_ID, 'owner'),
      m(U_DUP, ACME, 'viewer'),
      m(U_DUP, ACME, 'owner'),
      m(U_SUSPENDED, ACME, 'member', 'suspended'),
      m(U_PHANTOM, PHANTOM, 'member'),
    ])

  })

  afterAll(async () => {
    if (knexDb) await knexDb.destroy()
    if (!reachable) return
    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
    await admin.end()
  })

  beforeEach(() => {
    killSwitchMock.mockResolvedValue(true)
  })

  // Jest has no conditional skip for a whole describe at runtime; early-return
  // keeps DB-less CI green (same pattern as the migration integration tests).
  const it_ = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!reachable) return
      await fn()
    })

  describe('kill-switch ON (default — the owner-decided filter)', () => {
    it_('shows the direct-role org and HIDES the root org for a normal member', async () => {
      const body = await listFor(U_NORMAL)
      expect(ids(body)).toEqual([ACME])
      expect(body.organizations[0].user_role).toBe('admin')
      expect(body.pagination.total).toBe(1)
    })

    it_('HIDES non-direct ancestors (portal + root) of a direct org', async () => {
      const body = await listFor(U_NORMAL)
      expect(ids(body)).not.toContain(PORTAL) // ACME's parent, no direct row
      expect(ids(body)).not.toContain(ROOT_ORG_ID) // ACME's grandparent
    })

    it_('shows each direct org and skips the non-direct middle ancestor', async () => {
      const body = await listFor(U_SKIP)
      expect(ids(body)).toEqual([PORTAL, SALES].sort())
      expect(ids(body)).not.toContain(ACME) // ancestor of SALES, not a member
      expect(ids(body)).not.toContain(ROOT_ORG_ID)
    })

    it_('does not surface descendants the caller has no direct row for', async () => {
      const body = await listFor(U_NORMAL)
      expect(ids(body)).not.toContain(SALES) // child of ACME, no direct row
    })

    it_('a user whose only membership is the baseline root row sees nothing', async () => {
      const body = await listFor(U_ROOT_ONLY)
      expect(body.organizations).toEqual([])
      expect(body.pagination.total).toBe(0)
    })

    it_('a user with no membership rows no longer sees root by id', async () => {
      const body = await listFor(U_NO_ROWS)
      expect(body.organizations).toEqual([])
    })

    it_('an employee (user-role marker) STILL sees root, plus their direct orgs', async () => {
      const body = await listFor(U_EMPLOYEE, ['employee'])
      expect(ids(body)).toEqual([ROOT_ORG_ID, ACME].sort())
      expect(body.organizations.find(o => o.id === ROOT_ORG_ID)!.user_role).toBe('member')
    })

    it_('the legacy admin marker is staff too (same predicate as the shell)', async () => {
      const body = await listFor(U_EMPLOYEE, ['admin'])
      expect(ids(body)).toContain(ROOT_ORG_ID)
    })

    it_('a platform admin by root owner membership STILL sees root', async () => {
      const body = await listFor(U_ROOT_ADMIN, ['user'])
      expect(ids(body)).toEqual([ROOT_ORG_ID])
      expect(body.organizations[0].user_role).toBe('owner')
    })

    it_('staff without a root row still see root by id (pre-existing behavior)', async () => {
      const body = await listFor(U_NO_ROWS, ['employee'])
      expect(ids(body)).toEqual([ROOT_ORG_ID])
    })

    it_('a legacy type=platform org is hidden from non-staff even with a membership row', async () => {
      const body = await listFor(U_PHANTOM)
      expect(ids(body)).not.toContain(PHANTOM)
      expect(body.organizations).toEqual([])
    })

    it_('a suspended membership is not a direct role', async () => {
      const body = await listFor(U_SUSPENDED)
      expect(body.organizations).toEqual([])
    })

    it_('still dedupes to one row per org at the highest role (FFRNT-378)', async () => {
      const body = await listFor(U_DUP)
      expect(body.organizations).toHaveLength(1)
      expect(body.organizations[0]).toMatchObject({ id: ACME, user_role: 'owner' })
      expect(body.pagination.total).toBe(1)
    })

    it_('filters compose: a parent_id filter cannot reveal a hidden ancestor', async () => {
      // PORTAL is a child of ROOT; asking for children of ROOT must not list it
      // (no direct row) and must not list ROOT itself.
      const body = await listFor(U_NORMAL, ['user'], `?parent_id=${ROOT_ORG_ID}`)
      expect(body.organizations).toEqual([])
    })

    it_('a type=platform filter cannot reveal root to a non-staff caller', async () => {
      const body = await listFor(U_NORMAL, ['user'], '?type=platform')
      expect(body.organizations).toEqual([])
    })

    it_('pagination counts only visible orgs', async () => {
      const body = await listFor(U_SKIP, ['user'], '?limit=1&page=2&sort=name')
      expect(body.pagination.total).toBe(2)
      expect(body.organizations).toHaveLength(1)
    })
  })

  describe('kill-switch OFF (break-glass restores the previous list)', () => {
    beforeEach(() => {
      killSwitchMock.mockResolvedValue(false)
    })

    it_('normal member sees root again (direct memberships + root by id)', async () => {
      const body = await listFor(U_NORMAL)
      expect(ids(body)).toEqual([ROOT_ORG_ID, ACME].sort())
    })

    it_('a user with no rows still sees root by id', async () => {
      const body = await listFor(U_NO_ROWS)
      expect(ids(body)).toEqual([ROOT_ORG_ID])
    })

    it_('ancestors still are NOT pulled in structurally on the OFF path', async () => {
      const body = await listFor(U_SKIP)
      expect(ids(body)).not.toContain(ACME)
      expect(ids(body)).not.toContain(OTHER)
    })
  })

  it('has a reachable Postgres (otherwise the suite above is a deliberate no-op)', () => {
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(`[orglist-visibility] Postgres not reachable at ${HOST}:${PORT} — integration cases skipped`)
    }
    expect(true).toBe(true)
  })
})
