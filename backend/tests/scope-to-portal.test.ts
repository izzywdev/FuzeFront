jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import * as identityFlagModule from '../src/utils/identityFlag'
import {
  resolvePortalScopeDecision,
  applyPortalScope,
  scopeToPortal,
  PortalScopeDecision,
} from '../src/utils/scopeToPortal'
import { ROOT_PORTAL_ID } from '../src/repositories/portalRepository'

// ── decision resolution (BOTH flag states + the S6 AC4 unreachable-fails- ──
// closed-to-ENFORCED deviation + the platform-admin bypass + fail-closed on a
// missing/malformed portalId) ────────────────────────────────────────────────
describe('resolvePortalScopeDecision', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('flag OFF (administratively, reachable) -> unscoped, BYTE-IDENTICAL global behavior', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(false)

    const req: any = { user: { id: 'u1', portalId: 'prt_tenant_a' } }
    const decision = await resolvePortalScopeDecision(req)

    expect(decision).toEqual({ mode: 'unscoped', portalId: null })
  })

  it('flag ON + caller is a platform admin -> bypass (full cross-portal view), never the default', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(true)

    const req: any = { user: { id: 'admin-1', portalId: 'prt_tenant_a' } }
    const decision = await resolvePortalScopeDecision(req, {
      isPlatformAdmin: async userId => userId === 'admin-1',
    })

    expect(decision).toEqual({ mode: 'bypass', portalId: null })
  })

  it('flag ON + NOT a platform admin + valid portalId -> scoped to that portal', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(true)

    const req: any = { user: { id: 'u1', portalId: 'prt_tenant_a' } }
    const decision = await resolvePortalScopeDecision(req, {
      isPlatformAdmin: async () => false,
    })

    expect(decision).toEqual({ mode: 'scoped', portalId: 'prt_tenant_a' })
  })

  it('FAIL CLOSED: flag ON + missing req.user.portalId -> denied, never an unscoped fallback', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(true)

    const req: any = { user: { id: 'u1' } } // no portalId
    const decision = await resolvePortalScopeDecision(req, {
      isPlatformAdmin: async () => false,
    })

    expect(decision).toEqual({ mode: 'denied', portalId: null })
  })

  it('FAIL CLOSED: flag ON + malformed (non-string) portalId -> denied', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(true)

    const req: any = { user: { id: 'u1', portalId: 12345 } }
    const decision = await resolvePortalScopeDecision(req, {
      isPlatformAdmin: async () => false,
    })

    expect(decision).toEqual({ mode: 'denied', portalId: null })
  })

  it('FAIL CLOSED: flag ON + no req.user at all -> denied', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(true)

    const req: any = {}
    const decision = await resolvePortalScopeDecision(req)

    expect(decision).toEqual({ mode: 'denied', portalId: null })
  })

  it('an injected isPlatformAdmin override propagates (callers own their own error handling)', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(true)

    const req: any = { user: { id: 'u1', portalId: 'prt_tenant_a' } }

    // resolvePortalScopeDecision itself doesn't swallow an injected override's
    // error — that fail-safe behavior (deny the bypass, never grant it) lives
    // in the DEFAULT production isPlatformAdmin impl, exercised via
    // checkOrganizationPermission in the "default platform-admin authority"
    // describe block below.
    await expect(
      resolvePortalScopeDecision(req, {
        isPlatformAdmin: async () => {
          throw new Error('permit down')
        },
      })
    ).rejects.toThrow('permit down')
  })

  it('IDENTITY DEVIATION (S6 AC4): flag-service unreachable fails CLOSED to ENFORCED, not to OFF', async () => {
    // No override on isPortalScopedUsersEnabled itself here — exercise the
    // REAL fail-closed behavior (no @fuzeone/feature-flags package resolvable
    // in this test sandbox -> loadFlagsClient() returns null -> `true`).
    jest.restoreAllMocks()

    const req: any = { user: { id: 'u1' } } // no portalId, and no bypass
    const decision = await resolvePortalScopeDecision(req, { isPlatformAdmin: async () => false })

    // Enforced (flag "on" per fail-closed) + no valid portal context -> denied,
    // the SAFE (deny cross-portal visibility) outcome — never unscoped.
    expect(decision.mode).toBe('denied')
  })
})

// ── applyPortalScope — pure query-building, one assertion per mode ─────────
describe('applyPortalScope', () => {
  function fakeQuery() {
    const calls: string[] = []
    const query: any = {
      where(this: any, ...args: any[]) {
        calls.push('where')
        if (typeof args[0] === 'function') args[0].call(query)
        return query
      },
      orWhere(this: any, ...args: any[]) {
        calls.push('orWhere')
        if (typeof args[0] === 'function') args[0].call(query)
        return query
      },
      whereNull(this: any, ..._args: any[]) {
        calls.push('whereNull')
        return query
      },
      whereRaw(this: any, ..._args: any[]) {
        calls.push('whereRaw')
        return query
      },
    }
    return { query, calls }
  }

  it('unscoped -> query is returned untouched (no filter call at all)', () => {
    const { query, calls } = fakeQuery()
    const decision: PortalScopeDecision = { mode: 'unscoped', portalId: null }
    const result = applyPortalScope(query, decision)
    expect(result).toBe(query)
    expect(calls).toEqual([])
  })

  it('bypass -> query is returned untouched (full cross-portal view)', () => {
    const { query, calls } = fakeQuery()
    const decision: PortalScopeDecision = { mode: 'bypass', portalId: null }
    applyPortalScope(query, decision)
    expect(calls).toEqual([])
  })

  it('denied -> a whereRaw(1=0) filter is applied (never matches any row)', () => {
    const { query, calls } = fakeQuery()
    const decision: PortalScopeDecision = { mode: 'denied', portalId: null }
    applyPortalScope(query, decision)
    expect(calls).toEqual(['whereRaw'])
  })

  it('scoped to a NON-root portal -> a plain equality filter on the column', () => {
    const { query, calls } = fakeQuery()
    const decision: PortalScopeDecision = { mode: 'scoped', portalId: 'prt_tenant_a' }
    applyPortalScope(query, decision, 'home_portal_id')
    expect(calls).toEqual(['where'])
  })

  it('scoped to the ROOT portal -> matches NULL OR the root portal id', () => {
    const { query, calls } = fakeQuery()
    const decision: PortalScopeDecision = { mode: 'scoped', portalId: ROOT_PORTAL_ID }
    applyPortalScope(query, decision, 'home_portal_id')
    expect(calls).toEqual(['where', 'whereNull', 'orWhere'])
  })

  it('respects a custom column name (e.g. an aliased join column)', () => {
    const { query, calls } = fakeQuery()
    const decision: PortalScopeDecision = { mode: 'scoped', portalId: 'prt_tenant_a' }
    let capturedArgs: any[] = []
    query.where = (...args: any[]) => {
      calls.push('where')
      capturedArgs = args
      return query
    }
    applyPortalScope(query, decision, 'u.home_portal_id')
    expect(capturedArgs[0]).toBe('u.home_portal_id')
  })
})

// ── the DEFAULT platform-admin authority — MUST be the existing Permit ReBAC
// checkOrganizationPermission(userId, action, ROOT_ORG_ID) derivation, not a
// second/invented authority model. ─────────────────────────────────────────
describe('default platform-admin authority (no isPlatformAdmin override)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('grants bypass via checkOrganizationPermission("manage", ROOT_ORG_ID) — reused, not reinvented', async () => {
    jest.resetModules()
    jest.doMock('../src/config/permit', () => ({
      __esModule: true,
      default: { api: {} },
    }))
    const checkOrganizationPermission = jest.fn().mockResolvedValue(true)
    jest.doMock('../src/utils/permit/permission-check', () => ({
      __esModule: true,
      checkOrganizationPermission,
    }))
    jest.doMock('../src/utils/identityFlag', () => ({
      __esModule: true,
      getRequestPortalScopingEnabled: jest.fn().mockResolvedValue(true),
    }))

    const { resolvePortalScopeDecision: freshResolve } = await import('../src/utils/scopeToPortal')
    const { ROOT_ORG_ID } = await import('../src/migrations/015_seed_root_platform_organization')

    const req: any = { user: { id: 'admin-1', portalId: 'prt_tenant_a' } }
    const decision = await freshResolve(req)

    expect(decision.mode).toBe('bypass')
    expect(checkOrganizationPermission).toHaveBeenCalledWith('admin-1', 'manage', ROOT_ORG_ID)
  })

  it('a Permit error denies the bypass (falls through to normal portal scoping), never fails open', async () => {
    jest.resetModules()
    jest.doMock('../src/config/permit', () => ({
      __esModule: true,
      default: { api: {} },
    }))
    jest.doMock('../src/utils/permit/permission-check', () => ({
      __esModule: true,
      checkOrganizationPermission: jest.fn().mockRejectedValue(new Error('permit down')),
    }))
    jest.doMock('../src/utils/identityFlag', () => ({
      __esModule: true,
      getRequestPortalScopingEnabled: jest.fn().mockResolvedValue(true),
    }))

    const { resolvePortalScopeDecision: freshResolve } = await import('../src/utils/scopeToPortal')

    const req: any = { user: { id: 'u1', portalId: 'prt_tenant_a' } }
    const decision = await freshResolve(req)

    expect(decision).toEqual({ mode: 'scoped', portalId: 'prt_tenant_a' })
  })
})

describe('scopeToPortal (convenience wrapper)', () => {
  afterEach(() => jest.restoreAllMocks())

  it('composes resolvePortalScopeDecision + applyPortalScope in one call', async () => {
    jest.spyOn(identityFlagModule, 'isPortalScopedUsersEnabled').mockResolvedValue(false)
    const calls: string[] = []
    const query: any = {
      where(this: any) {
        calls.push('where')
        return query
      },
    }
    const req: any = { user: { id: 'u1', portalId: 'prt_tenant_a' } }

    const { decision } = await scopeToPortal(query, req)

    expect(decision.mode).toBe('unscoped')
    expect(calls).toEqual([]) // unscoped -> no filter applied
  })
})
