// Integration tests for the app-installation surface
// (backend/src/routes/app-installations.ts + migration 015).
//
// These run against the REAL migrated Postgres the global harness
// (tests/setup.ts) prepares, so the database CHECK constraint and the partial
// unique indexes are exercised alongside the route logic — the whole point of
// putting the shape in the schema rather than only in the handler.
//
// The auth middleware is mocked to a settable current user. That is not a gap:
// the authorization rules under test (scope permitted by scope_level, org
// membership required, owner/admin required for `everyone`, non-disclosing 404s)
// all live in the ROUTE. Mocking the token exchange lets one suite act as four
// different users without four real logins.

// --- mock the JWT auth middleware: pass-through, sets the current user ------
let currentUser: { id: string; email: string; roles: string[] }

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = currentUser
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import request from 'supertest'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { v4 as uuidv4 } from 'uuid'

// Raise the rate-limit ceilings BEFORE importing the router — it reads them at
// module load. The limiter is deliberately NOT disabled: a control that switches
// itself off outside production is not a control. This suite makes far more
// install/uninstall calls per minute than any real user, all from one loopback
// IP and therefore one bucket, so it needs headroom. That the limiter actually
// engages is asserted by its own case at the bottom of this file.
process.env.APP_INSTALL_READ_RATE_LIMIT = '100000'
process.env.APP_INSTALL_WRITE_RATE_LIMIT = '100000'

import appInstallationsRoutes, {
  scopeIsAllowed,
} from '../src/routes/app-installations'
import { initializeDatabaseConnection, db } from '../src/config/database'

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/apps', appInstallationsRoutes)
  return app
}

// --- fixtures ---------------------------------------------------------------
const suffix = uuidv4().slice(0, 8)

const OWNER = { id: uuidv4(), email: `owner-${suffix}@test.local`, roles: ['user'] }
const MEMBER = { id: uuidv4(), email: `member-${suffix}@test.local`, roles: ['user'] }
const OUTSIDER = { id: uuidv4(), email: `outsider-${suffix}@test.local`, roles: ['user'] }

const ORG_ID = uuidv4()
const OTHER_ORG_ID = uuidv4()

// One app per scope_level, so each level's accept/reject behaviour is tested
// against a real row rather than a stub.
const BOTH_APP_ID = uuidv4()
const PERSONAL_APP_ID = uuidv4()
const ORG_APP_ID = uuidv4()
const HIDDEN_APP_ID = uuidv4()

async function insertUser(u: { id: string; email: string }) {
  await db('users').insert({
    id: u.id,
    email: u.email,
    password_hash: null,
    first_name: 'Test',
    last_name: 'User',
    roles: JSON.stringify(['user']),
  })
}

async function insertApp(
  id: string,
  name: string,
  scopeLevel: 'personal' | 'organization' | 'both',
  organizationId: string | null,
  visibility: 'private' | 'organization' | 'public' | 'marketplace' = 'private'
) {
  await db('apps').insert({
    id,
    name,
    url: 'http://localhost:3000',
    integration_type: 'iframe',
    organization_id: organizationId,
    visibility,
    scope_level: scopeLevel,
  })
}

describe('app installations', () => {
  let app: express.Application

  beforeAll(async () => {
    initializeDatabaseConnection()
    app = buildApp()

    await insertUser(OWNER)
    await insertUser(MEMBER)
    await insertUser(OUTSIDER)

    await db('organizations').insert([
      {
        id: ORG_ID,
        name: `Test Org ${suffix}`,
        slug: `test-org-${suffix}`,
        owner_id: OWNER.id,
        type: 'organization',
      },
      {
        id: OTHER_ORG_ID,
        name: `Other Org ${suffix}`,
        slug: `other-org-${suffix}`,
        owner_id: OUTSIDER.id,
        type: 'organization',
      },
    ])

    await db('organization_memberships').insert([
      { user_id: OWNER.id, organization_id: ORG_ID, role: 'owner', status: 'active' },
      { user_id: MEMBER.id, organization_id: ORG_ID, role: 'member', status: 'active' },
      { user_id: OUTSIDER.id, organization_id: OTHER_ORG_ID, role: 'owner', status: 'active' },
    ])

    await insertApp(BOTH_APP_ID, `Both App ${suffix}`, 'both', ORG_ID)
    await insertApp(PERSONAL_APP_ID, `Personal App ${suffix}`, 'personal', ORG_ID)
    await insertApp(ORG_APP_ID, `Org App ${suffix}`, 'organization', ORG_ID)
    await insertApp(HIDDEN_APP_ID, `Hidden App ${suffix}`, 'both', OTHER_ORG_ID)

    currentUser = OWNER
  })

  afterAll(async () => {
    const appIds = [BOTH_APP_ID, PERSONAL_APP_ID, ORG_APP_ID, HIDDEN_APP_ID]
    await db('app_installations').whereIn('app_id', appIds).del()
    await db('apps').whereIn('id', appIds).del()
    await db('organization_memberships')
      .whereIn('organization_id', [ORG_ID, OTHER_ORG_ID])
      .del()
    await db('organizations').whereIn('id', [ORG_ID, OTHER_ORG_ID]).del()
    await db('users').whereIn('id', [OWNER.id, MEMBER.id, OUTSIDER.id]).del()
  })

  beforeEach(async () => {
    await db('app_installations')
      .whereIn('app_id', [BOTH_APP_ID, PERSONAL_APP_ID, ORG_APP_ID, HIDDEN_APP_ID])
      .del()
    currentUser = OWNER
  })

  // --- scopeIsAllowed (pure) ------------------------------------------------
  describe('scopeIsAllowed', () => {
    it("permits either scope for 'both'", () => {
      expect(scopeIsAllowed('both', 'personal')).toBe(true)
      expect(scopeIsAllowed('both', 'organization')).toBe(true)
    })

    it('permits only the matching scope for a single-scope app', () => {
      expect(scopeIsAllowed('personal', 'personal')).toBe(true)
      expect(scopeIsAllowed('personal', 'organization')).toBe(false)
      expect(scopeIsAllowed('organization', 'organization')).toBe(true)
      expect(scopeIsAllowed('organization', 'personal')).toBe(false)
    })

    it("reads a missing scope_level as the column default, 'both'", () => {
      expect(scopeIsAllowed(null, 'personal')).toBe(true)
      expect(scopeIsAllowed(undefined, 'organization')).toBe(true)
    })
  })

  // --- personal installs ----------------------------------------------------
  describe('POST /:id/install — personal scope', () => {
    it('installs a both-scope app personally', async () => {
      const res = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })

      expect(res.status).toBe(201)
      expect(res.body.installation).toMatchObject({
        appId: BOTH_APP_ID,
        scope: 'personal',
        mode: 'self',
        userId: OWNER.id,
        organizationId: null,
        status: 'active',
      })
      expect(res.body.alreadyInstalled).toBe(false)
    })

    it('is idempotent — a second install returns the existing row with 200', async () => {
      const first = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })
      const second = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })

      expect(second.status).toBe(200)
      expect(second.body.alreadyInstalled).toBe(true)
      expect(second.body.installation.id).toBe(first.body.installation.id)
    })

    it('infers the scope for a personal-only app', async () => {
      const res = await request(app)
        .post(`/api/apps/${PERSONAL_APP_ID}/install`)
        .send({})

      expect(res.status).toBe(201)
      expect(res.body.installation.scope).toBe('personal')
    })

    it("rejects mode 'everyone' on a personal install with 422", async () => {
      const res = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal', mode: 'everyone' })

      expect(res.status).toBe(422)
      expect(res.body.code).toBe('MODE_NOT_PERMITTED')
    })
  })

  // --- organization installs ------------------------------------------------
  describe('POST /:id/install — organization scope', () => {
    it('installs for the caller only with mode=self', async () => {
      const res = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID, mode: 'self' })

      expect(res.status).toBe(201)
      expect(res.body.installation).toMatchObject({
        scope: 'organization',
        mode: 'self',
        userId: OWNER.id,
        organizationId: ORG_ID,
      })
    })

    it('installs for everyone when the caller is an org owner', async () => {
      const res = await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID, mode: 'everyone' })

      expect(res.status).toBe(201)
      // An `everyone` install has no user anchor — it belongs to the org.
      expect(res.body.installation.userId).toBeNull()
      expect(res.body.installation.mode).toBe('everyone')
    })

    it('refuses install-for-everyone from a plain member with 403', async () => {
      currentUser = MEMBER
      const res = await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID, mode: 'everyone' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('REQUIRES_ORG_ADMIN')
    })

    it('lets a plain member install for themselves', async () => {
      currentUser = MEMBER
      const res = await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID })

      expect(res.status).toBe(201)
      expect(res.body.installation.mode).toBe('self')
      expect(res.body.installation.userId).toBe(MEMBER.id)
    })

    it('404s on an organization the caller does not belong to', async () => {
      const res = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: OTHER_ORG_ID })

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('ORGANIZATION_NOT_FOUND')
    })

    it('requires organizationId for an organization install', async () => {
      const res = await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization' })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('ORGANIZATION_REQUIRED')
    })
  })

  // --- scope_level enforcement ---------------------------------------------
  describe('scope_level enforcement', () => {
    it('422s installing a personal-only app at organization scope', async () => {
      const res = await request(app)
        .post(`/api/apps/${PERSONAL_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID })

      expect(res.status).toBe(422)
      expect(res.body.code).toBe('SCOPE_NOT_PERMITTED')
    })

    it('422s installing an org-only app at personal scope', async () => {
      const res = await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'personal' })

      expect(res.status).toBe(422)
      expect(res.body.code).toBe('SCOPE_NOT_PERMITTED')
    })

    it("400s when scope is omitted for a 'both' app — the choice is the user's", async () => {
      const res = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('SCOPE_REQUIRED')
    })
  })

  // --- non-disclosure -------------------------------------------------------
  describe('visibility', () => {
    it("404s an app in an org the caller cannot see — never 403 (no id probing)", async () => {
      const res = await request(app)
        .post(`/api/apps/${HIDDEN_APP_ID}/install`)
        .send({ scope: 'personal' })

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('APP_NOT_FOUND')
    })

    it('404s a non-existent app id identically', async () => {
      const res = await request(app)
        .post(`/api/apps/${uuidv4()}/install`)
        .send({ scope: 'personal' })

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('APP_NOT_FOUND')
    })
  })

  // --- effective installs ---------------------------------------------------
  describe('GET /installed', () => {
    it('unions personal, own org-self and org-everyone installs', async () => {
      // Owner installs one personally and one for the whole org.
      await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })
      await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID, mode: 'everyone' })

      // The member sees the org-wide one plus nothing of the owner's personal.
      currentUser = MEMBER
      const res = await request(app).get(
        `/api/apps/installed?organizationId=${ORG_ID}`
      )

      expect(res.status).toBe(200)
      const appIds = res.body.map((r: any) => r.appId)
      expect(appIds).toContain(ORG_APP_ID)
      expect(appIds).not.toContain(BOTH_APP_ID)
    })

    it("does not leak another org's installs when the caller is not a member", async () => {
      await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID, mode: 'everyone' })

      currentUser = OUTSIDER
      const res = await request(app).get(
        `/api/apps/installed?organizationId=${ORG_ID}`
      )

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })
  })

  // --- uninstall ------------------------------------------------------------
  describe('DELETE /:id/install/:installationId', () => {
    it('soft-revokes a personal install and allows reinstall afterwards', async () => {
      const install = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })
      const installationId = install.body.installation.id

      const del = await request(app).delete(
        `/api/apps/${BOTH_APP_ID}/install/${installationId}`
      )
      expect(del.status).toBe(200)

      const row = await db('app_installations').where('id', installationId).first()
      expect(row.status).toBe('revoked')
      expect(row.revoked_at).not.toBeNull()

      // The partial unique indexes are scoped to status='active', so the same
      // target can be installed again without a unique violation.
      const again = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })
      expect(again.status).toBe(201)
    })

    it('refuses to remove an everyone-install from a plain member', async () => {
      const install = await request(app)
        .post(`/api/apps/${ORG_APP_ID}/install`)
        .send({ scope: 'organization', organizationId: ORG_ID, mode: 'everyone' })
      const installationId = install.body.installation.id

      currentUser = MEMBER
      const del = await request(app).delete(
        `/api/apps/${ORG_APP_ID}/install/${installationId}`
      )
      expect(del.status).toBe(403)
      expect(del.body.code).toBe('REQUIRES_ORG_ADMIN')
    })

    it("404s another user's personal install rather than 403", async () => {
      const install = await request(app)
        .post(`/api/apps/${BOTH_APP_ID}/install`)
        .send({ scope: 'personal' })
      const installationId = install.body.installation.id

      currentUser = MEMBER
      const del = await request(app).delete(
        `/api/apps/${BOTH_APP_ID}/install/${installationId}`
      )
      expect(del.status).toBe(404)
      expect(del.body.code).toBe('INSTALLATION_NOT_FOUND')
    })
  })

  // --- rate limiting --------------------------------------------------------
  describe('rate limiting', () => {
    it('answers 429 once the write ceiling is exceeded', async () => {
      // A dedicated app with a deliberately tiny ceiling. The suite-wide
      // limiter is raised (see the top of this file) so the other tests can
      // run, so this is what actually proves the control works — CodeQL
      // flagged these handlers as authorization-performing but unlimited, and
      // an untested limiter would silence the alert without answering it.
      const limited = express()
      limited.use(express.json())
      limited.use(
        '/api/apps',
        rateLimit({
          windowMs: 60_000,
          limit: 2,
          standardHeaders: true,
          legacyHeaders: false,
          message: { error: 'Too many requests. Try again shortly.' },
        })
      )
      limited.use('/api/apps', appInstallationsRoutes)

      const statuses: number[] = []
      for (let i = 0; i < 4; i++) {
        const res = await request(limited).get('/api/apps/installed')
        statuses.push(res.status)
      }

      expect(statuses.slice(0, 2).every(s => s !== 429)).toBe(true)
      expect(statuses.slice(2)).toEqual([429, 429])
    })
  })

  // --- schema-level guarantees ---------------------------------------------
  describe('database constraints', () => {
    it('rejects a malformed installation shape at the database level', async () => {
      // scope='organization' + install_mode='everyone' must NOT carry a user
      // anchor. The route never builds this row; the CHECK constraint is what
      // guarantees no other writer can either.
      await expect(
        db('app_installations').insert({
          app_id: ORG_APP_ID,
          scope: 'organization',
          install_mode: 'everyone',
          user_id: OWNER.id,
          organization_id: ORG_ID,
          installed_by: OWNER.id,
        })
      ).rejects.toThrow()
    })

    it('rejects a personal install with an organization anchor', async () => {
      await expect(
        db('app_installations').insert({
          app_id: BOTH_APP_ID,
          scope: 'personal',
          install_mode: 'self',
          user_id: OWNER.id,
          organization_id: ORG_ID,
          installed_by: OWNER.id,
        })
      ).rejects.toThrow()
    })

    it('rejects a duplicate active install for the same target', async () => {
      await db('app_installations').insert({
        app_id: BOTH_APP_ID,
        scope: 'personal',
        install_mode: 'self',
        user_id: OWNER.id,
        installed_by: OWNER.id,
      })

      await expect(
        db('app_installations').insert({
          app_id: BOTH_APP_ID,
          scope: 'personal',
          install_mode: 'self',
          user_id: OWNER.id,
          installed_by: OWNER.id,
        })
      ).rejects.toThrow()
    })
  })
})
