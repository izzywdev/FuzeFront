/**
 * Unit tests for the AuthZ swap contract.
 *
 * Two things are proven here, both WITHOUT any network / real Permit:
 *  1. Swappability — a mock `AuthorizationProvider` injected via the factory is
 *     returned by `getAuthorizationProvider()`, so routes/middleware bind to the
 *     interface, never to a vendor.
 *  2. Fail-closed mapping — `PermitAuthorizationProvider` (running against the
 *     CI no-op Permit client, which resolves every call to `undefined`) never
 *     "allows" on missing data: decisions are falsy, list/read paths return
 *     empty, and bulkCheck is index-aligned.
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = 'ci-no-real-permit-calls'

import {
  getAuthorizationProvider,
  setAuthorizationProvider,
} from '../src/providers/authzFactory'
import { PermitAuthorizationProvider } from '../src/providers/permit/PermitAuthorizationProvider'
import type {
  AuthorizationProvider,
  AuthzQuery,
} from '../src/providers/AuthorizationProvider'

const q = (over: Partial<AuthzQuery> = {}): AuthzQuery => ({
  subject: 'user-1',
  tenant: 'tenant-1',
  resource: { type: 'App' },
  action: 'read',
  ...over,
})

describe('authorization provider swap contract', () => {
  afterEach(() => setAuthorizationProvider(null))

  it('returns an injected mock provider (proves the interface is swappable)', async () => {
    const calls: AuthzQuery[] = []
    const mock: AuthorizationProvider = {
      check: async query => {
        calls.push(query)
        return true
      },
      bulkCheck: async queries => queries.map(() => true),
      getPermissions: async () => ['App:read'],
      grant: async () => ({ id: 'g1', subject: 'u', tenant: 't', role: 'r' }),
      revoke: async () => {},
      listGrants: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
      listTenants: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
      createTenant: async input => ({ id: 't1', name: input.name }),
      getTenant: async () => null,
      listMembers: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
      addMember: async (_t, input) => ({ userId: input.userId!, roles: input.roles ?? [] }),
      removeMember: async () => {},
      listRoles: async () => [{ key: 'admin' }],
      assignRoles: async (_t, userId, roles) => ({ userId, roles }),
    }
    setAuthorizationProvider(mock)

    const provider = getAuthorizationProvider()
    expect(provider).toBe(mock)
    await expect(provider.check(q())).resolves.toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].subject).toBe('user-1')
  })

  it('defaults to the Permit-backed provider when none injected', () => {
    setAuthorizationProvider(null)
    expect(getAuthorizationProvider()).toBeInstanceOf(PermitAuthorizationProvider)
  })
})

describe('PermitAuthorizationProvider fail-closed mapping', () => {
  const provider = new PermitAuthorizationProvider()

  it('does not allow when the engine returns no decision', async () => {
    // No-op Permit resolves check() to undefined — must be falsy, never true.
    await expect(provider.check(q())).resolves.toBeFalsy()
  })

  it('bulkCheck([]) short-circuits to []', async () => {
    await expect(provider.bulkCheck([])).resolves.toEqual([])
  })

  it('bulkCheck stays index-aligned and never allows on empty data', async () => {
    const results = await provider.bulkCheck([q(), q({ action: 'write' })])
    expect(results).toHaveLength(2)
    expect(results.every(r => r !== true)).toBe(true)
  })

  it('getPermissions tolerates an empty/undefined engine result', async () => {
    await expect(provider.getPermissions('user-1', 'tenant-1')).resolves.toEqual([])
  })

  it('listGrants / listTenants / listMembers return empty single pages', async () => {
    const grants = await provider.listGrants({ subject: 'u', tenant: 't' })
    expect(grants.items).toEqual([])
    expect(grants.page.hasMore).toBe(false)

    const tenants = await provider.listTenants('u', {})
    expect(tenants.items).toEqual([])

    const members = await provider.listMembers('t', {})
    expect(members.items).toEqual([])
  })

  it('revoke requires an identifiable grant', async () => {
    await expect(provider.revoke({})).rejects.toThrow()
    // identity-tuple form is accepted (idempotent no-op under the mock)
    await expect(
      provider.revoke({ subject: 'u', tenant: 't', role: 'admin' })
    ).resolves.toBeUndefined()
  })
})
