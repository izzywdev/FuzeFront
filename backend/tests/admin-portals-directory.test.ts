/**
 * Portals Directory (backend slice S1) — real-Postgres integration tests for
 * the two new `GET /api/v1/admin/portals` fields (`identityMode`,
 * `launchUrl`), gated behind `fuzefront.platform.portals-directory`.
 *
 * Uses the shared jest global setup (tests/setup.ts — real Postgres, full
 * migration chain applied in beforeAll, including 023_portals_identity_mode)
 * and the REAL router (`createAdminPortalRouter`) wired to the REAL
 * `authenticateToken`/`requireRole(['admin'])` middleware + the REAL
 * `createAdminPortalStore()` — not the mocked-store unit tests in
 * `admin-portals-routes.test.ts`. Mirrors `tests/portal-routes.test.ts`'s
 * pattern for a real DB-backed app + JWT signing + flag mocking via
 * jest.spyOn (mutating the shared module's exported function — the same
 * "must go through the module namespace object" reasoning documented in
 * `utils/portalFlag.ts`'s `getRequestPortalsEnabled`, which applies here too
 * since `routes/adminPortals.ts` calls `isPortalsDirectoryEnabled` as a
 * CROSS-MODULE import, so jest.spyOn on the exports object is observed).
 *
 * Every test filters the list via `?q=<unique-slug>` so it is immune to
 * portal rows created by OTHER test files sharing this same Postgres
 * instance (jest runs test files as separate processes against one DB).
 */
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

import * as portalsDirectoryFlagModule from '../src/utils/portalsDirectoryFlag'
import * as permissionCheckModule from '../src/utils/permit/permission-check'
import { db, initializeDatabaseConnection } from '../src/config/database'
import { authenticateToken, requireRole } from '../src/middleware/auth'
import { createAdminPortalRouter } from '../src/routes/adminPortals'
import { rowToPortal, getPortalDomains } from '../src/repositories/portalRepository'

let directoryEnabled = false

// Maps `${organizationId}:${action}` -> boolean, same pattern as
// admin-portals-readonly-authz.test.ts (which owns the exhaustive
// read-vs-manage authorization matrix). This file only needs Permit mocked
// at all so its flag-ON tests — which exist to assert response SHAPE
// (identityMode/launchUrl), not authorization semantics — can reach the 200
// path for an admin who owns the portal they just created, instead of
// hitting the real (unreachable-in-CI) PDP and failing closed to 403.
let permitGrants: Record<string, boolean> = {}

beforeAll(() => {
  initializeDatabaseConnection()
  jest
    .spyOn(portalsDirectoryFlagModule, 'isPortalsDirectoryEnabled')
    .mockImplementation(async () => directoryEnabled)
  jest
    .spyOn(permissionCheckModule, 'bulkCheckPermissions')
    .mockImplementation(async checks =>
      checks.map(check => permitGrants[`${check.resource.tenant}:${check.action}`] ?? false)
    )
})

beforeEach(() => {
  directoryEnabled = false
  permitGrants = {}
})

const app = express()
app.use(express.json())
app.use(
  '/api/v1/admin/portals',
  createAdminPortalRouter({
    authenticate: authenticateToken,
    authorize: requireRole(['admin']),
  })
)

async function createUser(roles: string[] = ['user']): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `admin-portals-directory-${id.slice(0, 8)}@test.local`,
    first_name: 'Directory',
    last_name: 'Test',
    roles: JSON.stringify(roles),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: {
  slug: string
  identityMode?: 'soft' | 'hard'
  domain?: string
}): Promise<{ portalId: string; organizationId: string }> {
  const ownerId = await createUser(['user'])
  const orgId = uuidv4()
  await db('organizations').insert({
    id: orgId,
    name: opts.slug,
    slug: `${opts.slug}-${orgId.slice(0, 6)}`,
    owner_id: ownerId,
    type: 'organization',
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}),
    is_active: true,
    provisioning_state: 'active',
  })
  const portalId = `prt_${uuidv4().replace(/-/g, '')}`
  const row: Record<string, unknown> = {
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
    is_root: false,
  }
  if (opts.identityMode) row.identity_mode = opts.identityMode
  await db('portals').insert(row)
  if (opts.domain) {
    await db('portal_domains').insert({
      portal_id: portalId,
      domain: opts.domain,
      kind: 'subdomain',
      is_primary: true,
      verification_status: 'verified',
      tls_status: 'none',
    })
  }
  return { portalId, organizationId: orgId }
}

function signToken(userId: string): string {
  return jwt.sign({ userId, sessionId: uuidv4() }, process.env.JWT_SECRET!, { expiresIn: '24h' })
}

describe('GET /api/v1/admin/portals — Portals Directory (backend slice S1)', () => {
  it('flag ON: identityMode + launchUrl (derived from the primary domain) are present', async () => {
    directoryEnabled = true
    const adminId = await createUser(['admin'])
    const slug = `hard-${uuidv4().slice(0, 8)}`
    const { organizationId } = await createPortal({
      slug,
      identityMode: 'hard',
      domain: `${slug}.example.com`,
    })
    permitGrants[`${organizationId}:read`] = true
    permitGrants[`${organizationId}:manage`] = true

    const response = await request(app)
      .get(`/api/v1/admin/portals?q=${slug}`)
      .set('Authorization', `Bearer ${signToken(adminId)}`)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0]).toMatchObject({
      slug,
      identityMode: 'hard',
      launchUrl: `https://${slug}.example.com`,
    })
  })

  it('flag ON: identityMode defaults to soft and launchUrl falls back to the default subdomain when no primary domain exists', async () => {
    directoryEnabled = true
    const adminId = await createUser(['admin'])
    const slug = `soft-${uuidv4().slice(0, 8)}`
    const { organizationId } = await createPortal({ slug })
    permitGrants[`${organizationId}:read`] = true
    permitGrants[`${organizationId}:manage`] = true

    const response = await request(app)
      .get(`/api/v1/admin/portals?q=${slug}`)
      .set('Authorization', `Bearer ${signToken(adminId)}`)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0]).toMatchObject({
      slug,
      identityMode: 'soft',
      launchUrl: `https://${slug}.fuzefront.com`,
    })
  })

  it('flag OFF: response is byte-identical to the pre-flag shape (no identityMode/launchUrl keys)', async () => {
    directoryEnabled = false
    const adminId = await createUser(['admin'])
    const slug = `flagoff-${uuidv4().slice(0, 8)}`
    const { portalId } = await createPortal({
      slug,
      identityMode: 'hard',
      domain: `${slug}.example.com`,
    })

    const response = await request(app)
      .get(`/api/v1/admin/portals?q=${slug}`)
      .set('Authorization', `Bearer ${signToken(adminId)}`)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)

    const row = await db('portals').where({ id: portalId }).first()
    const expected = rowToPortal(row, await getPortalDomains(portalId, db))
    // toEqual fails on extra keys too, not just mismatched values — proves
    // neither `identityMode` nor `launchUrl` leaked into the flag-OFF shape.
    expect(response.body.items[0]).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  it('non-admin caller gets 403 regardless of flag state — no portal data (or the new fields) is ever returned', async () => {
    directoryEnabled = true
    const userId = await createUser(['user'])
    const slug = `bola-${uuidv4().slice(0, 8)}`
    await createPortal({ slug, identityMode: 'hard' })

    const response = await request(app)
      .get(`/api/v1/admin/portals?q=${slug}`)
      .set('Authorization', `Bearer ${signToken(userId)}`)

    expect(response.status).toBe(403)
    expect(response.body.items).toBeUndefined()
    expect(response.body.identityMode).toBeUndefined()
  })

  it('401 when unauthenticated, regardless of flag state', async () => {
    directoryEnabled = true
    const response = await request(app).get('/api/v1/admin/portals')
    expect(response.status).toBe(401)
  })
})
