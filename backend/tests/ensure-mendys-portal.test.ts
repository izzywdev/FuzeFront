import { v4 as uuidv4 } from 'uuid'

// Avoid importing the real Permit SDK (needs PERMIT_API_KEY at import time),
// and stub the Permit util modules the default client calls into — same
// convention as tests/portal-provisioning.test.ts. ensureMendysPortal treats
// Permit failures as non-fatal anyway, but we assert the happy-path calls.
jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))
jest.mock('../src/utils/permit/tenant-management', () => ({
  __esModule: true,
  createTenantInPermit: jest.fn(async () => true),
  isAlreadyExistsError: jest.fn(() => false),
}))
jest.mock('../src/utils/permit/resource-instances', () => ({
  __esModule: true,
  createOrganizationResourceInstance: jest.fn(async () => true),
  setOrganizationParent: jest.fn(async () => true),
}))

import { db } from '../src/config/database'
import {
  ensureMendysPortal,
  MENDYS_PORTAL_SLUG,
  MENDYS_PORTAL_DOMAIN,
  MENDYS_ORG_SLUG,
} from '../src/services/ensureMendysPortal'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

const PROVISION_ENV = 'MENDYS_PORTAL_PROVISION'

async function cleanupMendys(): Promise<void> {
  const portal = await db('portals').where({ slug: MENDYS_PORTAL_SLUG }).first()
  if (portal) {
    await db('portal_domains').where({ portal_id: portal.id }).del()
    await db('portals').where({ id: portal.id }).del()
  }
  await db('portal_domains').where({ domain: MENDYS_PORTAL_DOMAIN }).del()
  await db('organizations').where({ slug: MENDYS_ORG_SLUG }).del()
}

describe('ensureMendysPortal', () => {
  let testUserId: string

  beforeAll(async () => {
    // A user must exist to own the Mendys org (mirrors ensureRootPortal's
    // fresh-install tolerance). Create a disposable admin.
    testUserId = uuidv4()
    await db('users')
      .insert({
        id: testUserId,
        email: `mendys-seed-test-${testUserId}@example.com`,
        roles: JSON.stringify(['admin']),
      })
      .onConflict('id')
      .ignore()
  })

  afterAll(async () => {
    await cleanupMendys()
    await db('users').where({ id: testUserId }).del()
  })

  beforeEach(async () => {
    await cleanupMendys()
  })

  afterEach(() => {
    delete process.env[PROVISION_ENV]
  })

  it('is a no-op (returns null) when the gate env is unset', async () => {
    delete process.env[PROVISION_ENV]
    const result = await ensureMendysPortal(db)
    expect(result).toBeNull()
    const row = await db('portals').where({ slug: MENDYS_PORTAL_SLUG }).first()
    expect(row).toBeUndefined()
  })

  it('provisions the Mendys tenant portal when the gate env is "true"', async () => {
    process.env[PROVISION_ENV] = 'true'
    const portal = await ensureMendysPortal(db)

    expect(portal).not.toBeNull()
    expect(portal!.slug).toBe(MENDYS_PORTAL_SLUG)
    expect(portal!.isRoot).toBe(false)

    // Portal row: hard identity, active, reseller.
    const row = await db('portals').where({ slug: MENDYS_PORTAL_SLUG }).first()
    expect(row.identity_mode).toBe('hard')
    expect(row.status).toBe('active')
    expect(row.billing_mode).toBe('reseller')

    // Org silo: a child of the root org.
    const org = await db('organizations').where({ slug: MENDYS_ORG_SLUG }).first()
    expect(org).toBeDefined()
    expect(org.parent_id).toBe(ROOT_ORG_ID)
    expect(row.organization_id).toBe(org.id)

    // Custom primary domain.
    const domain = await db('portal_domains').where({ domain: MENDYS_PORTAL_DOMAIN }).first()
    expect(domain).toBeDefined()
    expect(domain.portal_id).toBe(row.id)
    expect(!!domain.is_primary).toBe(true)
    expect(domain.kind).toBe('custom')
    expect(portal!.primaryDomain).toBe(MENDYS_PORTAL_DOMAIN)
  })

  it('is idempotent — a second call creates no duplicate rows', async () => {
    process.env[PROVISION_ENV] = 'true'
    await ensureMendysPortal(db)
    await ensureMendysPortal(db)

    const portals = await db('portals').where({ slug: MENDYS_PORTAL_SLUG })
    const orgs = await db('organizations').where({ slug: MENDYS_ORG_SLUG })
    const domains = await db('portal_domains').where({ domain: MENDYS_PORTAL_DOMAIN })
    expect(portals).toHaveLength(1)
    expect(orgs).toHaveLength(1)
    expect(domains).toHaveLength(1)
  })

  it("reconciles a pre-existing 'soft'/'provisioning' Mendys row to hard+active", async () => {
    // Simulate a stray weaker row (e.g. created by the generic console flow
    // before this seed existed).
    const org = {
      id: uuidv4(),
      name: 'MendysRobotics',
      slug: MENDYS_ORG_SLUG,
      parent_id: ROOT_ORG_ID,
      owner_id: testUserId,
      type: 'organization',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({}),
      is_active: true,
      provisioning_state: 'active',
    }
    await db('organizations').insert(org)
    await db('portals').insert({
      id: uuidv4(),
      organization_id: org.id,
      slug: MENDYS_PORTAL_SLUG,
      name: 'MendysRobotics',
      status: 'provisioning',
      billing_mode: 'free',
      branding: JSON.stringify({ name: 'MendysRobotics' }),
      identity_policy: JSON.stringify({}),
      is_root: false,
      identity_mode: 'soft',
    })

    process.env[PROVISION_ENV] = 'true'
    await ensureMendysPortal(db)

    const row = await db('portals').where({ slug: MENDYS_PORTAL_SLUG }).first()
    expect(row.identity_mode).toBe('hard')
    expect(row.status).toBe('active')
  })
})
