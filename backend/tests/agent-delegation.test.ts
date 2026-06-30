import {
  AgentDelegation,
  PermitAgentClient,
  agentKeyFor,
  checkDelegatedPermission,
  syncAgentToPermit,
  removeAgentFromPermit,
} from '../src/utils/permit/agent-identity'

// A fake Permit client that grants permissions only to specific (user, tenant)
// pairs — so we can prove the agent's reach is EXACTLY the delegating user's,
// and that cross-tenant requests never even reach the user check.
function makeFakePermit(grants: Array<{ user: string; tenant: string; action: string }>) {
  const checkCalls: Array<{ user: string; action: string; tenant: string }> = []
  const syncCalls: any[] = []
  const deleteCalls: string[] = []
  const client: PermitAgentClient = {
    check: async (user, action, resource) => {
      checkCalls.push({ user, action, tenant: resource.tenant })
      return grants.some(
        g => g.user === user && g.tenant === resource.tenant && g.action === action
      )
    },
    api: {
      users: {
        sync: async (u: any) => {
          syncCalls.push(u)
        },
        delete: async (key: string) => {
          deleteCalls.push(key)
        },
      },
    },
  }
  return { client, checkCalls, syncCalls, deleteCalls }
}

const TENANT_A = 'org-aaaa'
const TENANT_B = 'org-bbbb'
const USER = 'user-1111'
const OTHER_USER = 'user-9999'

const delegation: AgentDelegation = {
  agentKey: agentKeyFor('svc-account-sub'),
  delegatesUser: USER,
  tenant: TENANT_A,
}

describe('agent delegation — checkDelegatedPermission', () => {
  it('allows exactly what the delegating user can do in the bound tenant', async () => {
    const { client, checkCalls } = makeFakePermit([
      { user: USER, tenant: TENANT_A, action: 'read' },
    ])
    const allowed = await checkDelegatedPermission(client, delegation, {
      action: 'read',
      resource: { type: 'Organization', tenant: TENANT_A },
    })
    expect(allowed).toBe(true)
    // Critically: the check was performed AS THE USER, not as the agent key.
    expect(checkCalls).toEqual([{ user: USER, action: 'read', tenant: TENANT_A }])
  })

  it('denies an action the delegating user does NOT have (no escalation beyond the user)', async () => {
    const { client } = makeFakePermit([
      { user: USER, tenant: TENANT_A, action: 'read' },
    ])
    const allowed = await checkDelegatedPermission(client, delegation, {
      action: 'delete',
      resource: { type: 'Organization', tenant: TENANT_A },
    })
    expect(allowed).toBe(false)
  })

  it('DENIES cross-tenant: a resource in another tenant is rejected before Permit is consulted', async () => {
    // The delegating user is even granted the action in TENANT_B, but the agent
    // is bound to TENANT_A, so it must still be denied — and must not call check.
    const { client, checkCalls } = makeFakePermit([
      { user: USER, tenant: TENANT_B, action: 'read' },
    ])
    const allowed = await checkDelegatedPermission(client, delegation, {
      action: 'read',
      resource: { type: 'Organization', tenant: TENANT_B },
    })
    expect(allowed).toBe(false)
    expect(checkCalls).toHaveLength(0) // short-circuited before Permit
  })

  it('DENIES cross-user: the agent can never resolve to any user but its bound one', async () => {
    // Another user has the grant; the agent is bound to USER, who does not.
    const { client, checkCalls } = makeFakePermit([
      { user: OTHER_USER, tenant: TENANT_A, action: 'manage' },
    ])
    const allowed = await checkDelegatedPermission(client, delegation, {
      action: 'manage',
      resource: { type: 'Organization', tenant: TENANT_A },
    })
    expect(allowed).toBe(false)
    // It checked as USER (its bound user), never as OTHER_USER.
    expect(checkCalls).toEqual([{ user: USER, action: 'manage', tenant: TENANT_A }])
  })

  it('fails safe (deny) when the Permit check throws', async () => {
    const client: PermitAgentClient = {
      check: async () => {
        throw new Error('PDP unreachable')
      },
      api: { users: { sync: async () => undefined, delete: async () => undefined } },
    }
    const allowed = await checkDelegatedPermission(client, delegation, {
      action: 'read',
      resource: { type: 'Organization', tenant: TENANT_A },
    })
    expect(allowed).toBe(false)
  })
})

describe('agent delegation — Permit principal sync', () => {
  it('agentKeyFor namespaces the agent distinctly from human users', () => {
    expect(agentKeyFor('abc')).toBe('agent:abc')
  })

  it('syncs the agent as a DISTINCT principal tagged type=agent with its binding', async () => {
    const { client, syncCalls } = makeFakePermit([])
    const ok = await syncAgentToPermit(client, delegation)
    expect(ok).toBe(true)
    expect(syncCalls).toHaveLength(1)
    expect(syncCalls[0]).toMatchObject({
      key: 'agent:svc-account-sub',
      attributes: { type: 'agent', delegate_of: USER, tenant: TENANT_A },
    })
  })

  it('removeAgentFromPermit deletes the agent principal', async () => {
    const { client, deleteCalls } = makeFakePermit([])
    const ok = await removeAgentFromPermit(client, delegation.agentKey)
    expect(ok).toBe(true)
    expect(deleteCalls).toEqual(['agent:svc-account-sub'])
  })
})
