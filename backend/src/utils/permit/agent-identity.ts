import permit from '../../config/permit'

/**
 * Machine/service-account (agent) identities for FuzeFront.
 *
 * An agent is a non-human principal (an Authentik service account authenticating
 * via the OAuth2 client-credentials grant) that acts ON BEHALF OF a single human
 * user, within a single tenant (organization). See the frozen contract:
 * docs/superpowers/plans/2026-06-30-agent-identities.md
 *
 * Authorization model (the important part):
 *   - The agent is synced to Permit as a DISTINCT principal (keyed `agent:<sub>`),
 *     NOT as a human user. Its attributes record that it is an agent and which
 *     user/tenant it is bound to.
 *   - The `Agent —delegate_of→ User` relationship is RECORDED in Permit for
 *     audit/visibility (see permit/schema.ts).
 *   - ENFORCEMENT does NOT rely on Permit deriving tenant-level roles across that
 *     relationship (which is not clean in the permitio 2.4.0 SDK). Instead, the
 *     binding `(delegatesUser, tenant)` is the authoritative source of truth, and
 *     a permission check resolves the agent to its bound user and runs the check
 *     AS THE USER, scoped to the bound tenant.
 *
 * This makes the two required denials STRUCTURAL rather than policy-dependent:
 *   - Cross-user escalation is impossible — an agent has no grants of its own and
 *     can only ever resolve to its single bound user.
 *   - Cross-tenant access is impossible — the bound tenant is pinned and any
 *     request-supplied tenant that differs is denied before Permit is consulted.
 */

/**
 * The authoritative binding for an agent: it acts on behalf of exactly one user,
 * within exactly one tenant. This is established at agent-registration time and
 * is the source of truth for the agent's reach.
 */
export interface AgentDelegation {
  /** Permit principal key for the agent, e.g. `agent:<authentik-service-account-sub>`. */
  agentKey: string
  /** UUID of the human user the agent acts on behalf of. */
  delegatesUser: string
  /** The single org/tenant the agent is permitted to act within. */
  tenant: string
}

/** A permission question, expressed against the existing Permit resource model. */
export interface DelegatedCheck {
  action: string
  resource: { type: string; tenant: string; key?: string }
  context?: Record<string, unknown>
}

/**
 * The slice of the permitio client surface used here. Declared structurally so
 * tests can inject a fake without the real SDK / PERMIT_API_KEY (same pattern as
 * permit/sync-permit-schema.ts).
 */
export interface PermitAgentClient {
  check(
    user: string,
    action: string,
    resource: { type: string; tenant: string; key?: string },
    context?: Record<string, unknown>
  ): Promise<boolean>
  api: {
    users: {
      sync(user: unknown): Promise<unknown>
      delete(key: string): Promise<unknown>
    }
  }
}

/** Conventional Permit principal key for an agent given its Authentik subject. */
export function agentKeyFor(authentikSub: string): string {
  return `agent:${authentikSub}`
}

/**
 * Syncs an agent into Permit as a DISTINCT principal (not a human user). The
 * `type: 'agent'` attribute and `delegate_of`/`tenant` attributes make the
 * binding visible in the Permit dashboard and queryable for audit. This does
 * NOT grant the agent any permissions — enforcement is via the delegating user.
 */
export async function syncAgentToPermit(
  permitClient: PermitAgentClient,
  delegation: AgentDelegation
): Promise<boolean> {
  try {
    await permitClient.api.users.sync({
      key: delegation.agentKey,
      attributes: {
        type: 'agent',
        delegate_of: delegation.delegatesUser,
        tenant: delegation.tenant,
      },
    })
    console.log(
      `Agent ${delegation.agentKey} synced to Permit (delegate_of ${delegation.delegatesUser}, tenant ${delegation.tenant})`
    )
    return true
  } catch (error) {
    console.error(`Error syncing agent ${delegation.agentKey} to Permit:`, error)
    return false
  }
}

/**
 * Removes an agent principal from Permit (e.g. on agent deregistration). The
 * agent's secret lives in Authentik and is revoked there independently.
 */
export async function removeAgentFromPermit(
  permitClient: PermitAgentClient,
  agentKey: string
): Promise<boolean> {
  try {
    await permitClient.api.users.delete(agentKey)
    console.log(`Agent ${agentKey} removed from Permit`)
    return true
  } catch (error) {
    console.error(`Error removing agent ${agentKey} from Permit:`, error)
    return false
  }
}

/**
 * The worked permission check for an agent. Resolves the agent to its bound
 * `(delegatesUser, tenant)` and runs `permit.check` AS THE USER.
 *
 * Denials are structural:
 *   - resource in a DIFFERENT tenant than the agent's bound tenant -> deny.
 *   - otherwise the result is EXACTLY what the delegating user is allowed; the
 *     agent can never exceed the user's reach.
 *
 * Fails safe: any error denies (mirrors checkPermission in permission-check.ts).
 */
export async function checkDelegatedPermission(
  permitClient: PermitAgentClient,
  delegation: AgentDelegation,
  check: DelegatedCheck
): Promise<boolean> {
  try {
    // Cross-tenant guard (defense in depth): an agent may ONLY act within the
    // single tenant it is bound to. Deny before Permit is even consulted.
    if (check.resource.tenant !== delegation.tenant) {
      console.log(
        `Agent ${delegation.agentKey} DENIED: cross-tenant (bound ${delegation.tenant}, requested ${check.resource.tenant})`
      )
      return false
    }

    // The agent's reach IS the delegating user's reach: check as the user.
    // Cross-user escalation is impossible — the agent resolves to one fixed user.
    const result = await permitClient.check(
      delegation.delegatesUser,
      check.action,
      check.resource,
      check.context
    )
    console.log(
      `Agent ${delegation.agentKey} check (as user ${delegation.delegatesUser}) - ` +
        `Action: ${check.action}, Resource: ${check.resource.type}, Tenant: ${check.resource.tenant}, Result: ${result}`
    )
    return result
  } catch (error) {
    console.error(`Error checking delegated permission for ${delegation.agentKey}:`, error)
    return false // fail safe
  }
}

/** Convenience wrapper bound to the real configured Permit client. */
export function checkAgentPermission(
  delegation: AgentDelegation,
  check: DelegatedCheck
): Promise<boolean> {
  return checkDelegatedPermission(
    permit as unknown as PermitAgentClient,
    delegation,
    check
  )
}
