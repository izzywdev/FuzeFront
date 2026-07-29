import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import {
  ensureRootPortal,
  findPortalByDomain,
  findPortalBySlug,
  getRootPortal,
  ROOT_PORTAL_ID,
  ROOT_PORTAL_SLUG,
  rowToPortal,
  rowToPortalContext,
  generatePortalId,
} from '../src/repositories/portalRepository'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(admin = false): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `portal-schema-${id.slice(0, 8)}@test.local`,
    first_name: 'Portal',
    last_name: 'Schema',
    roles: JSON.stringify(admin ? ['admin', 'user'] : ['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

// Clean slate for the portal tables before each test — other suites in this
// run may also seed a root portal, and we want ensureRootPortal's idempotency
// and fail-loud behavior to be independently verifiable per test.
beforeEach(async () => {
  await db('portal_domains').del()
  await db('portals').del()
})

describe('portals + portal_domains schema (FF-EPIC-09-S1)', () => {
  it('creates the portals and portal_domains tables with expected columns', async () => {
    const hasPortals = await db.schema.hasTable('portals')
    const hasDomains = await db.schema.hasTable('portal_domains')
    expect(hasPortals).toBe(true)
    expect(hasDomains).toBe(true)

    for (const col of [
      'id',
      'organization_id',
      'slug',
      'name',
      'status',
      'billing_mode',
      'branding',
      'identity_policy',
      'owner_email',
      'is_root',
      'created_at',
      'updated_at',
    ]) {
      expect(await db.schema.hasColumn('portals', col)).toBe(true)
    }
    for (const col of [
      'id',
      'portal_id',
      'domain',
      'kind',
      'is_primary',
      'verification_status',
      'tls_status',
      'created_at',
    ]) {
      expect(await db.schema.hasColumn('portal_domains', col)).toBe(true)
    }
  })

  it('enforces a unique organization_id FK and a unique slug', async () => {
    const userId = await createUser()
    const orgId = uuidv4()
    await db('organizations').insert({
      id: orgId,
      name: 'Northwind',
      slug: `northwind-${orgId.slice(0, 8)}`,
      owner_id: userId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })

    await db('portals').insert({
      id: generatePortalId(),
      organization_id: orgId,
      slug: 'northwind',
      name: 'Northwind',
      status: 'active',
      billing_mode: 'free',
      branding: JSON.stringify({ name: 'Northwind' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      is_root: false,
    })

    // Same organization_id again -> unique violation.
    await expect(
      db('portals').insert({
        id: generatePortalId(),
        organization_id: orgId,
        slug: 'northwind-2',
        name: 'Northwind 2',
        status: 'active',
        billing_mode: 'free',
        branding: JSON.stringify({ name: 'Northwind 2' }),
        identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
        is_root: false,
      })
    ).rejects.toMatchObject({ code: '23505' })

    // Same slug (different org) -> unique violation.
    const orgId2 = uuidv4()
    await db('organizations').insert({
      id: orgId2,
      name: 'Northwind B',
      slug: `northwind-b-${orgId2.slice(0, 8)}`,
      owner_id: userId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
    await expect(
      db('portals').insert({
        id: generatePortalId(),
        organization_id: orgId2,
        slug: 'northwind',
        name: 'Northwind Clone',
        status: 'active',
        billing_mode: 'free',
        branding: JSON.stringify({ name: 'Clone' }),
        identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
        is_root: false,
      })
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('enforces a unique domain and at most one primary domain per portal', async () => {
    const userId = await createUser()
    const orgId = uuidv4()
    await db('organizations').insert({
      id: orgId,
      name: 'Acme',
      slug: `acme-${orgId.slice(0, 8)}`,
      owner_id: userId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
    const portalId = generatePortalId()
    await db('portals').insert({
      id: portalId,
      organization_id: orgId,
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      billing_mode: 'free',
      branding: JSON.stringify({ name: 'Acme' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      is_root: false,
    })

    await db('portal_domains').insert({
      portal_id: portalId,
      domain: 'acme.fuzefront.com',
      kind: 'subdomain',
      is_primary: true,
      verification_status: 'verified',
      tls_status: 'issued',
    })

    // Duplicate domain string -> unique violation.
    await expect(
      db('portal_domains').insert({
        portal_id: portalId,
        domain: 'acme.fuzefront.com',
        kind: 'subdomain',
        is_primary: false,
      })
    ).rejects.toMatchObject({ code: '23505' })

    // A second primary domain for the SAME portal -> partial unique index violation.
    await expect(
      db('portal_domains').insert({
        portal_id: portalId,
        domain: 'acme.example.com',
        kind: 'custom',
        is_primary: true,
      })
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('findPortalByDomain / findPortalBySlug resolve inserted rows', async () => {
    const userId = await createUser()
    const orgId = uuidv4()
    await db('organizations').insert({
      id: orgId,
      name: 'Contoso',
      slug: `contoso-${orgId.slice(0, 8)}`,
      owner_id: userId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    })
    const portalId = generatePortalId()
    await db('portals').insert({
      id: portalId,
      organization_id: orgId,
      slug: 'contoso',
      name: 'Contoso',
      status: 'active',
      billing_mode: 'free',
      branding: JSON.stringify({ name: 'Contoso' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      is_root: false,
    })
    await db('portal_domains').insert({
      portal_id: portalId,
      domain: 'contoso.fuzefront.com',
      kind: 'subdomain',
      is_primary: true,
    })

    const byDomain = await findPortalByDomain('CONTOSO.fuzefront.com', db)
    expect(byDomain?.id).toBe(portalId)

    const bySlug = await findPortalBySlug('contoso', db)
    expect(bySlug?.id).toBe(portalId)

    const dto = rowToPortal(byDomain, [
      await db('portal_domains').where({ portal_id: portalId }).first(),
    ])
    expect(dto.slug).toBe('contoso')
    expect(dto.primaryDomain).toBe('contoso.fuzefront.com')
    expect(dto.organizationId).toBe(orgId)
  })
})

describe('ensureRootPortal (FF-EPIC-09-S1 AC2-4)', () => {
  // Exercised against a minimal fake db (rather than the real, shared test
  // Postgres) so "zero users exist yet" is actually reachable — other suites
  // in this run share the same database and always have users/orgs present.
  it('is a no-op returning null on a fresh DB with no users (self-heals on next boot)', async () => {
    const fakeDb: any = (_table: string) => {
      const chain = {
        where: () => chain,
        whereRaw: () => chain,
        orderBy: () => chain,
        first: async () => undefined, // no root portal, no platform org, no users
      }
      return chain
    }
    const result = await ensureRootPortal(fakeDb)
    expect(result).toBeNull()
  })

  it('seeds exactly one root portal row (slug fuzefront) mapped to a platform org', async () => {
    await createUser(true)

    const created = await ensureRootPortal(db)
    expect(created).not.toBeNull()
    expect(created!.slug).toBe(ROOT_PORTAL_SLUG)
    expect(created!.id).toBe(ROOT_PORTAL_ID)
    expect(created!.status).toBe('active')
    expect(created!.isRoot).toBe(true)

    const org = await db('organizations').where({ id: created!.organizationId }).first()
    expect(org).toBeTruthy()
    expect(org.type).toBe('platform')
  })

  it('is idempotent — a second call returns the same row, no duplicate', async () => {
    await createUser(true)
    const first = await ensureRootPortal(db)
    const second = await ensureRootPortal(db)

    expect(first!.id).toBe(second!.id)

    const count = await db('portals').where({ slug: ROOT_PORTAL_SLUG }).count<{ c: string }[]>('* as c')
    expect(Number(count[0].c)).toBe(1)
  })

  it('concurrent calls yield exactly one root portal (race safety)', async () => {
    await createUser(true)
    const [a, b] = await Promise.all([ensureRootPortal(db), ensureRootPortal(db)])
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()

    const count = await db('portals').where({ slug: ROOT_PORTAL_SLUG }).count<{ c: string }[]>('* as c')
    expect(Number(count[0].c)).toBe(1)
  })

  // A real `portals.organization_id` FK is ON DELETE CASCADE, so a genuinely
  // orphaned row cannot exist under normal constraint enforcement — it only
  // arises from a legacy/pre-FK DB, exactly the scenario AC4 calls out. We
  // exercise the repository logic directly with a minimal fake `db` (same
  // shape ensureRootPortal calls) rather than fighting the FK to construct an
  // impossible-under-constraints row.
  it('AC4 — fails loudly rather than silently duplicating when the root portal is orphaned', async () => {
    const calls: string[] = []
    const fakeDb: any = (table: string) => {
      calls.push(table)
      const chain = {
        where: () => chain,
        first: async () => {
          if (table === 'portals') {
            return { id: ROOT_PORTAL_ID, slug: ROOT_PORTAL_SLUG, organization_id: 'missing-org-id' }
          }
          if (table === 'organizations') {
            return undefined // the org row is gone — legacy/corrupted DB
          }
          return undefined
        },
      }
      return chain
    }

    await expect(ensureRootPortal(fakeDb)).rejects.toThrow(/refusing to auto-repair/i)
    expect(calls).toEqual(expect.arrayContaining(['portals', 'organizations']))
  })
})

describe('rowToPortalContext — public projection (FF-EPIC-10-S2)', () => {
  it('exposes only id/slug/isRoot/branding/identityPolicy/authEntry, never org/billing/domains', () => {
    const row = {
      id: 'prt_test',
      slug: 'northwind',
      name: 'Northwind',
      status: 'active',
      is_root: false,
      organization_id: 'should-not-leak',
      owner_email: 'owner@example.com',
      billing_mode: 'reseller',
      branding: JSON.stringify({ name: 'Northwind', accent: '#123456' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: true }),
      created_at: new Date(),
      updated_at: new Date(),
    }

    const ctx = rowToPortalContext(row)
    expect(ctx).toEqual({
      id: 'prt_test',
      slug: 'northwind',
      isRoot: false,
      branding: { name: 'Northwind', logo: null, favicon: null, accent: '#123456', tagline: null },
      identityPolicy: { allowPasswordLogin: true, allowSelfSignup: true, mfaRequired: false, ssoProviders: [] },
      authEntry: {
        loginUrl: '/p/northwind/login',
        signupUrl: '/p/northwind/signup',
        forgotPasswordUrl: '/p/northwind/forgot-password',
        ssoProviders: [],
      },
    })
    expect((ctx as any).organizationId).toBeUndefined()
    expect((ctx as any).ownerEmail).toBeUndefined()
    expect((ctx as any).billingMode).toBeUndefined()
  })

  it('roots at "/" (no /p/<slug> prefix) for the root portal', () => {
    const row = {
      id: ROOT_PORTAL_ID,
      slug: ROOT_PORTAL_SLUG,
      name: 'FuzeFront',
      status: 'active',
      is_root: true,
      organization_id: 'org',
      billing_mode: 'platform',
      branding: JSON.stringify({ name: 'FuzeFront' }),
      identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
      created_at: new Date(),
      updated_at: new Date(),
    }
    const ctx = rowToPortalContext(row)
    expect(ctx.authEntry.loginUrl).toBe('/login')
    expect(ctx.isRoot).toBe(true)
  })
})
