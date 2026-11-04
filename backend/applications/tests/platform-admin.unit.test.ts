// FFRNT-379 — platform-admin is an AUTHORIZATION POLICY (owner OR admin-or-higher
// on the ROOT org), not the `admin` role string; and `private` visibility is
// creator/owner-only behind fuzefront.app-registry.private-owner-only.
import * as fs from 'fs'
import * as path from 'path'

const ROOT = '00000000-0000-0000-0000-000000000010'
const OTHER_ORG = '00000000-0000-0000-0000-0000000000aa'
const U = '11111111-1111-4111-8111-111111111111'

type Tables = {
  organizations: any[]
  organization_memberships: any[]
}
let tables: Tables
let failLookup = false
const queried: string[] = []

jest.mock('../src/config/database', () => ({
  db: jest.fn((table: string) => {
    queried.push(table)
    const conds: Array<[string, any]> = []
    const chain: any = {
      where: (c: string, v: any) => {
        conds.push([c, v])
        return chain
      },
      whereIn: () => chain,
      first: async () => {
        if (failLookup) throw new Error('db down')
        return run().then(r => r[0])
      },
      select: () => {
        if (failLookup) return Promise.reject(new Error('db down'))
        return run()
      },
      then: undefined,
    }
    const run = async () =>
      ((tables as any)[table] ?? []).filter((row: any) =>
        conds.every(([c, v]) => row[c] === v)
      )
    return chain
  }),
}))

import { resolveCaller } from '../src/app-registry/caller'
import {
  MEMBERSHIP_ROLE_RANK,
  roleIsAdminOrHigher,
  isRootOrgPlatformAdmin,
} from '../src/app-registry/platform-admin'
import {
  canRead,
  AppCaller,
  AppRecord,
  ROOT_ORG_ID,
} from '../src/app-registry/service'
import { setFlagClient } from '../src/app-registry/flags'

function flags(values: Record<string, boolean>) {
  setFlagClient({
    getBooleanValue: async (k: string, d: boolean) => (k in values ? values[k] : d),
  })
}

beforeEach(() => {
  tables = { organizations: [], organization_memberships: [] }
  failLookup = false
  queried.length = 0
  flags({})
})
afterAll(() => setFlagClient(null))

describe('root-org platform-admin policy (resolveCaller)', () => {
  it('uses the canonical ROOT_ORG_ID', () => {
    expect(ROOT_ORG_ID).toBe(ROOT)
  })

  it('root-org OWNER is a platform admin (no membership row, no admin role string)', async () => {
    tables.organizations.push({ id: ROOT, owner_id: U, is_active: true })
    const c = await resolveCaller({ id: U, roles: ['user'] })
    expect(c.isPlatformAdmin).toBe(true)
  })

  it('root-org ADMIN member is a platform admin', async () => {
    tables.organization_memberships.push({
      user_id: U, organization_id: ROOT, status: 'active', role: 'admin',
    })
    expect((await resolveCaller({ id: U, roles: [] })).isPlatformAdmin).toBe(true)
  })

  it('root-org OWNER-role member is a platform admin', async () => {
    tables.organization_memberships.push({
      user_id: U, organization_id: ROOT, status: 'active', role: 'owner',
    })
    expect((await resolveCaller({ id: U, roles: [] })).isPlatformAdmin).toBe(true)
  })

  it('root-org plain MEMBER is NOT a platform admin', async () => {
    tables.organization_memberships.push({
      user_id: U, organization_id: ROOT, status: 'active', role: 'member',
    })
    expect((await resolveCaller({ id: U, roles: [] })).isPlatformAdmin).toBe(false)
  })

  it('admin member of a NON-root org is NOT a platform admin', async () => {
    tables.organization_memberships.push({
      user_id: U, organization_id: OTHER_ORG, status: 'active', role: 'admin',
    })
    expect((await resolveCaller({ id: U, roles: [] })).isPlatformAdmin).toBe(false)
  })

  it('the magic `admin` role string no longer confers platform admin on a real user', async () => {
    const c = await resolveCaller({ id: U, roles: ['admin'] })
    expect(c.isPlatformAdmin).toBe(false)
  })

  it('an inactive root-org admin membership does not count', async () => {
    tables.organization_memberships.push({
      user_id: U, organization_id: ROOT, status: 'suspended', role: 'admin',
    })
    expect((await resolveCaller({ id: U, roles: [] })).isPlatformAdmin).toBe(false)
  })

  it('FAILS CLOSED when the lookup errors', async () => {
    tables.organizations.push({ id: ROOT, owner_id: U, is_active: true })
    failLookup = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await isRootOrgPlatformAdmin(U)).toBe(false)
    // and the full caller resolution never yields an admin on a DB fault
    // (getMemberOrgIds rejects => the route 500s; nothing is granted)
    await expect(resolveCaller({ id: U, roles: ['admin'] })).rejects.toThrow()
    spy.mockRestore()
  })

  it('service principal stays authorized WITHOUT any DB lookup', async () => {
    const c = await resolveCaller({ id: 'consumer-registration', roles: ['admin'] })
    expect(c.isPlatformAdmin).toBe(true)
    expect(queried).toEqual([])
  })

  it('a service principal without the admin role is not authorized', async () => {
    const c = await resolveCaller({ id: 'consumer-registration', roles: [] })
    expect(c.isPlatformAdmin).toBe(false)
  })
})

describe('role rank (parity with S1 MEMBERSHIP_ROLE_RANK)', () => {
  it('matches backend/security/src/permit/schema.ts', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'security', 'src', 'permit', 'schema.ts'),
      'utf8'
    )
    const body = src.match(/MEMBERSHIP_ROLE_RANK:[\s\S]*?=\s*\{([\s\S]*?)\}/)![1]
    const parsed: Record<string, number> = {}
    for (const m of body.matchAll(/(\w+):\s*(\d+)/g)) parsed[m[1]] = Number(m[2])
    expect(MEMBERSHIP_ROLE_RANK).toEqual(parsed)
  })

  it('admin-or-higher means owner/admin only', () => {
    expect(['owner', 'admin'].every(roleIsAdminOrHigher)).toBe(true)
    expect(['member', 'viewer', 'developer', 'bogus', undefined].some(roleIsAdminOrHigher)).toBe(false)
  })
})

describe('FFRNT-379 / S4 private = creator/owner-only', () => {
  const FLAG = 'fuzefront.app-registry.private-owner-only'
  const app = (over: Partial<AppRecord> = {}): AppRecord =>
    ({
      slug: 'x', status: 'activated', mode: 'portal', builtin: false,
      organizationId: 'org-a', createdByUserId: 'creator',
      manifest: { visibility: 'private' } as any,
      ...over,
    }) as AppRecord
  const member: AppCaller = {
    userId: 'other', organizationIds: ['org-a'], roles: [], isPlatformAdmin: false,
  }

  it('flag OFF (field absent): private is org-wide like organization (unchanged)', () => {
    expect(canRead(app(), member)).toBe(true)
  })

  it('flag ON: ordinary org member can NOT read a private app; organization stays org-wide', () => {
    const on = { ...member, privateOwnerOnly: true, ownedOrgIds: [] }
    expect(canRead(app(), on)).toBe(false)
    expect(canRead(app({ manifest: { visibility: 'organization' } as any }), on)).toBe(true)
  })

  it('flag ON: the creator (still in the org) reads it', () => {
    const c = { ...member, userId: 'creator', privateOwnerOnly: true, ownedOrgIds: [] }
    expect(canRead(app(), c)).toBe(true)
  })

  it('flag ON: a creator who left the org loses access', () => {
    const c = { ...member, userId: 'creator', organizationIds: [], privateOwnerOnly: true, ownedOrgIds: [] }
    expect(canRead(app(), c)).toBe(false)
  })

  it('flag ON: the org OWNER reads it (even without a membership row)', () => {
    const c = { ...member, userId: 'own', organizationIds: [], privateOwnerOnly: true, ownedOrgIds: ['org-a'] }
    expect(canRead(app(), c)).toBe(true)
  })

  it('flag ON: owner of a DIFFERENT org cannot', () => {
    const c = { ...member, userId: 'own', organizationIds: [], privateOwnerOnly: true, ownedOrgIds: ['org-b'] }
    expect(canRead(app(), c)).toBe(false)
  })

  it('flag ON: unknown creator (null) => only owner/platform admin', () => {
    const noCreator = app({ createdByUserId: null })
    const on = { ...member, privateOwnerOnly: true, ownedOrgIds: [] }
    expect(canRead(noCreator, on)).toBe(false)
    expect(canRead(noCreator, { ...on, isPlatformAdmin: true })).toBe(true)
  })

  it('flag ON: root-org-owned private app (executive) — member denied, platform admin allowed', () => {
    const exec = app({ organizationId: ROOT, createdByUserId: null })
    const rootMember = { ...member, organizationIds: [ROOT], privateOwnerOnly: true, ownedOrgIds: [] }
    expect(canRead(exec, rootMember)).toBe(false)
    expect(canRead(exec, { ...rootMember, isPlatformAdmin: true })).toBe(true)
  })

  it('resolveCaller wires the flag: OFF leaves fields unset, ON populates ownership', async () => {
    tables.organizations.push({ id: 'org-o', owner_id: U, is_active: true })
    flags({ [FLAG]: false })
    const off = await resolveCaller({ id: U, roles: [] })
    expect(off.privateOwnerOnly).toBeUndefined()
    expect(off.ownedOrgIds).toBeUndefined()

    flags({ [FLAG]: true })
    const on = await resolveCaller({ id: U, roles: [] })
    expect(on.privateOwnerOnly).toBe(true)
    expect(on.ownedOrgIds).toEqual(['org-o'])
  })

  it('an unreachable flag client defaults to OFF (no behavior change)', async () => {
    setFlagClient({ getBooleanValue: async () => { throw new Error('unleash down') } })
    const c = await resolveCaller({ id: U, roles: [] })
    expect(c.privateOwnerOnly).toBeUndefined()
  })
})
