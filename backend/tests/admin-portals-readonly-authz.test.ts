/**
 * Portals Directory read-vs-no-access authorization refinement (backend
 * slice S5) — real-Postgres integration tests for `GET /api/v1/admin/portals`,
 * mirroring `tests/admin-portals-directory.test.ts`'s pattern: the shared
 * jest global setup (tests/setup.ts — real Postgres, full migration chain),
 * the REAL router (`createAdminPortalRouter`) wired to the REAL
 * `authenticateToken`/`requireRole(['admin'])` middleware + the REAL
 * `createAdminPortalStore()`. Permit itself is mocked (no live PDP in this
 * environment) via `jest.spyOn` on `utils/permit/permission-check`'s
 * `bulkCheckPermissions` — the SAME "must go through the module namespace
 * object" pattern the S1 suite already uses for the flag.
 *
 * Every test filters the list via `?q=<unique-slug>` so it is immune to
 * portal rows created by OTHER test files sharing this same Postgres
 * instance.
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

let directoryEnabled = false

/**
 * Maps `${organizationId}:${action}` -> boolean. Every test sets this up
 * per-org/action; anything not explicitly granted defaults to `false`
 * (fail-closed), exercising `resolvePortalReadManageCapabilities`'s `?? false`
 * defensive default along the way.
 */
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
    email: `admin-portals-readonly-${id.slice(0, 8)}@test.local`,
    first_name: 'ReadOnly',
    last_name: 'Test',
    roles: JSON.stringify(roles),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: { slug: string; domain?: string }): Promise<{
  portalId: string
  organizationId: string
}> {
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
  await db('portals').insert({
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
    is_root: false,
  })
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

function grantRead(organizationId: string) {
  permitGrants[`${organizationId}:read`] = true
}
function grantManage(organizationId: string) {
  permitGrants[`${organizationId}:read`] = true
  permitGrants[`${organizationId}:manage`] = true
}

describe('GET /api/v1/admin/portals — read-vs-no-access refinement (backend slice S5)', () => {
  describe('flag ON', () => {
    it('no-read caller -> 403, no rows leaked', async () => {
      directoryEnabled = true
      const userId = await createUser(['user'])
      const slug = `s5-noread-${uuidv4().slice(0, 8)}`
      await createPortal({ slug })
      // Deliberately grant nothing for this org — permitGrants stays empty.

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${slug}`)
        .set('Authorization', `Bearer ${signToken(userId)}`)

      expect(response.status).toBe(403)
      expect(response.body.items).toBeUndefined()
    })

    it('read-only caller -> 200, rows present, canManage/canOpen false, launchUrl absent', async () => {
      directoryEnabled = true
      const userId = await createUser(['user'])
      const slug = `s5-readonly-${uuidv4().slice(0, 8)}`
      const { organizationId } = await createPortal({ slug, domain: `${slug}.example.com` })
      grantRead(organizationId)

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${slug}`)
        .set('Authorization', `Bearer ${signToken(userId)}`)

      expect(response.status).toBe(200)
      expect(response.body.items).toHaveLength(1)
      const item = response.body.items[0]
      expect(item).toMatchObject({
        slug,
        identityMode: 'soft',
        canManage: false,
        canOpen: false,
      })
      expect(item.launchUrl).toBeUndefined()
      expect('launchUrl' in item).toBe(false)
    })

    it('manage caller -> 200, canManage/canOpen true, launchUrl present', async () => {
      directoryEnabled = true
      const userId = await createUser(['user'])
      const slug = `s5-manage-${uuidv4().slice(0, 8)}`
      const { organizationId } = await createPortal({ slug, domain: `${slug}.example.com` })
      grantManage(organizationId)

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${slug}`)
        .set('Authorization', `Bearer ${signToken(userId)}`)

      expect(response.status).toBe(200)
      expect(response.body.items).toHaveLength(1)
      expect(response.body.items[0]).toMatchObject({
        slug,
        identityMode: 'soft',
        canManage: true,
        canOpen: true,
        launchUrl: `https://${slug}.example.com`,
      })
    })

    it('mixed case: manages some, reads others, cannot see the rest — per-row capabilities correct, unreadable portal never returned', async () => {
      directoryEnabled = true
      const userId = await createUser(['user'])
      const prefix = `s5-mixed-${uuidv4().slice(0, 8)}`

      const managed = await createPortal({ slug: `${prefix}-managed`, domain: `${prefix}-managed.example.com` })
      const readable = await createPortal({ slug: `${prefix}-readable` })
      const denied = await createPortal({ slug: `${prefix}-denied` })

      grantManage(managed.organizationId)
      grantRead(readable.organizationId)
      // `denied.organizationId` gets nothing.

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${prefix}`)
        .set('Authorization', `Bearer ${signToken(userId)}`)

      expect(response.status).toBe(200)
      expect(response.body.items).toHaveLength(2)

      const bySlug = Object.fromEntries(
        response.body.items.map((item: any) => [item.slug, item])
      )
      expect(bySlug[`${prefix}-denied`]).toBeUndefined()

      expect(bySlug[`${prefix}-managed`]).toMatchObject({
        canManage: true,
        canOpen: true,
        launchUrl: `https://${prefix}-managed.example.com`,
      })

      expect(bySlug[`${prefix}-readable`]).toMatchObject({
        canManage: false,
        canOpen: false,
      })
      expect('launchUrl' in bySlug[`${prefix}-readable`]).toBe(false)
    })

    it('fail-closed: a degraded/partial Permit bulk response never grants an unresolved row', async () => {
      directoryEnabled = true
      const userId = await createUser(['user'])
      const slug = `s5-partial-${uuidv4().slice(0, 8)}`
      await createPortal({ slug })

      // Simulate the degraded-PDP path `permission-check.ts` itself
      // documents (bulkCheck returning FEWER results than requested, e.g.
      // OPA 502) by resolving with an EMPTY array. This is exactly what the
      // real `bulkCheckPermissions` already fails closed to internally on a
      // genuine Permit error (falls back to per-check `checkPermission`,
      // which itself catches and returns `false`) — asserting here that
      // `resolvePortalReadManageCapabilities`'s `?? false` default on a
      // short/empty result array never mis-reads a missing entry as
      // granted.
      jest.spyOn(permissionCheckModule, 'bulkCheckPermissions').mockResolvedValueOnce([])

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${slug}`)
        .set('Authorization', `Bearer ${signToken(userId)}`)

      expect(response.status).toBe(403)
      expect(response.body.items).toBeUndefined()
    })
  })

  describe('flag OFF', () => {
    it('identical to today: admin-only 403 for a non-admin, no capability fields', async () => {
      directoryEnabled = false
      const userId = await createUser(['user'])
      const slug = `s5-off-nonadmin-${uuidv4().slice(0, 8)}`
      const { organizationId } = await createPortal({ slug })
      // Even with FULL Permit manage authority, flag OFF must still 403 a
      // non-admin — the blanket requireRole(['admin']) gate is untouched.
      grantManage(organizationId)

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${slug}`)
        .set('Authorization', `Bearer ${signToken(userId)}`)

      expect(response.status).toBe(403)
      expect(response.body.items).toBeUndefined()
    })

    it('identical to today: admin caller -> 200, no canManage/canOpen/identityMode/launchUrl keys', async () => {
      directoryEnabled = false
      const adminId = await createUser(['admin'])
      const slug = `s5-off-admin-${uuidv4().slice(0, 8)}`
      await createPortal({ slug, domain: `${slug}.example.com` })

      const response = await request(app)
        .get(`/api/v1/admin/portals?q=${slug}`)
        .set('Authorization', `Bearer ${signToken(adminId)}`)

      expect(response.status).toBe(200)
      expect(response.body.items).toHaveLength(1)
      const item = response.body.items[0]
      expect('canManage' in item).toBe(false)
      expect('canOpen' in item).toBe(false)
      expect('identityMode' in item).toBe(false)
      expect('launchUrl' in item).toBe(false)
    })
  })
})
