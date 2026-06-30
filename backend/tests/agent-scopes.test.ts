import { permitSchema } from '../src/permit/schema'
import {
  AgentScopeRef,
  RoleAssignmentClient,
  assignAgentScope,
  grantApprovedRelease,
  revokeApprovedRelease,
  checkAgentRead,
  actionForSensitivity,
  resourceInstanceId,
} from '../src/utils/permit/agent-scopes'

/**
 * A fake PDP + control-plane that models the Secret instance-scoped roles
 * exactly as declared in the shared schema (src/permit/schema.ts). It lets us
 * exercise the WORKED EXAMPLE deterministically, without a live Permit PDP:
 *
 *   check(agent, "read_sensitive", card) denies until approved_release is
 *   assigned, allows while the grant is live, then denies after revocation.
 *
 * The fake resolves a role's permissions from the schema, so if the schema's
 * role/permission wiring regresses, this test fails too.
 */
function makeFakePdp() {
  const secret = permitSchema.resources.find(r => r.key === 'Secret')!
  const rolePerms: Record<string, string[]> = Object.fromEntries(
    Object.entries(secret.roles!).map(([k, v]) => [k, v.permissions])
  )

  // key: `${user}|${resource_instance}` -> set of role keys
  const assignments = new Map<string, Set<string>>()
  const akey = (user: string, instance: string) => `${user}|${instance}`

  const client: RoleAssignmentClient = {
    api: {
      roleAssignments: {
        assign: async (body: any) => {
          const k = akey(body.user, body.resource_instance)
          if (!assignments.has(k)) assignments.set(k, new Set())
          assignments.get(k)!.add(body.role)
        },
        unassign: async (body: any) => {
          const k = akey(body.user, body.resource_instance)
          assignments.get(k)?.delete(body.role)
        },
      },
    },
    check: async (user, action, resource) => {
      const instance = resourceInstanceId(resource.type, resource.key!)
      const roles = assignments.get(akey(user, instance))
      if (!roles) return false // out-of-scope = no assignment = deny
      for (const role of roles) {
        if ((rolePerms[role] || []).includes(action)) return true
      }
      return false
    },
  }
  return { client }
}

const ref: AgentScopeRef = {
  agent: 'agent:fuzekeys-broker',
  resourceType: 'Secret',
  resourceKey: 'card_4242',
  tenant: 'org_acme',
}

describe('agent-scope conventions', () => {
  it('maps sensitivity tiers to the correct action', () => {
    expect(actionForSensitivity('LOW')).toBe('read')
    expect(actionForSensitivity('MEDIUM')).toBe('read')
    expect(actionForSensitivity('HIGH')).toBe('read_sensitive')
  })

  it('out-of-scope agent is denied (no assignment = deny)', async () => {
    const { client } = makeFakePdp()
    // Never assigned anything.
    expect(await checkAgentRead(ref, 'LOW', client)).toBe(false)
    expect(await checkAgentRead(ref, 'HIGH', client)).toBe(false)
  })

  it('in-scope agent_reader can read LOW/MEDIUM but NOT HIGH', async () => {
    const { client } = makeFakePdp()
    await assignAgentScope(ref, client)

    expect(await checkAgentRead(ref, 'LOW', client)).toBe(true)
    expect(await checkAgentRead(ref, 'MEDIUM', client)).toBe(true)
    // HIGH needs read_sensitive, which agent_reader does not grant.
    expect(await checkAgentRead(ref, 'HIGH', client)).toBe(false)
  })

  it('WORKED EXAMPLE: read_sensitive denies, then allows for the TTL, then denies', async () => {
    const { client } = makeFakePdp()
    await assignAgentScope(ref, client)

    // 1. Before approval: HIGH read is denied.
    expect(await checkAgentRead(ref, 'HIGH', client)).toBe(false)

    // 2. Human approves -> broker grants the time-boxed role.
    const grant = await grantApprovedRelease(ref, 300, client)
    expect(grant).not.toBeNull()
    expect(grant!.expiresAt.getTime() - grant!.grantedAt.getTime()).toBe(300_000)

    // 3. While the grant is live: HIGH read is allowed.
    expect(await checkAgentRead(ref, 'HIGH', client)).toBe(true)

    // 4. TTL elapses -> broker revokes (Permit holds no timer of its own).
    await revokeApprovedRelease(ref, client)

    // 5. After expiry: HIGH read is denied again — but the in-scope agent_reader
    //    role survives, so LOW/MEDIUM reads still work.
    expect(await checkAgentRead(ref, 'HIGH', client)).toBe(false)
    expect(await checkAgentRead(ref, 'LOW', client)).toBe(true)
  })

  it('refuses to grant approved_release with a non-positive TTL', async () => {
    const { client } = makeFakePdp()
    await assignAgentScope(ref, client)

    expect(await grantApprovedRelease(ref, 0, client)).toBeNull()
    expect(await grantApprovedRelease(ref, -5, client)).toBeNull()
    // No grant happened, so HIGH stays denied.
    expect(await checkAgentRead(ref, 'HIGH', client)).toBe(false)
  })
})
