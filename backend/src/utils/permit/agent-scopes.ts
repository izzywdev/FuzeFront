import permit from '../../config/permit'

/**
 * Shared agent-scope conventions for the FuzeFront Permit model.
 *
 * Implements the three standardized patterns documented in
 * docs/guides/PERMIT_AGENT_SCOPES.md (originated for the FuzeKeys MCP
 * Secrets-Broker):
 *
 *   1. Per-resource (instance-scoped) agent roles — an agent is granted a role
 *      against a SPECIFIC resource instance. Out-of-scope = no assignment =
 *      deny. There is no broad "all secrets" role.
 *   2. Sensitivity tiers (LOW | MEDIUM | HIGH) — LOW/MEDIUM are readable by the
 *      in-scope `agent_reader` role via the `read` action; HIGH requires the
 *      separate `read_sensitive` action which `agent_reader` does NOT grant.
 *   3. Time-boxed `approved_release` role — after a human approves a HIGH
 *      request, the broker assigns this role (which grants `read_sensitive`)
 *      and revokes it at `expiresAt`. The approval queue, notifier, and the
 *      revocation timer all live in the broker; only the decision lives here.
 *
 * The functions take an injectable `client` (defaulting to the configured
 * `permit` instance) so the lifecycle can be exercised in tests without a live
 * PDP. See backend/tests/agent-scopes.test.ts for the worked example.
 */

export const AGENT_READER_ROLE = 'agent_reader'
export const APPROVED_RELEASE_ROLE = 'approved_release'

export type Sensitivity = 'LOW' | 'MEDIUM' | 'HIGH'

/** Identifies one agent's relationship to one specific resource instance. */
export interface AgentScopeRef {
  /** The agent identity key (the Permit "user"). */
  agent: string
  /** The resource type, e.g. 'Secret'. */
  resourceType: string
  /** The specific instance key, e.g. a card / secret id. */
  resourceKey: string
  /** The tenant (organization) the instance belongs to. */
  tenant: string
}

export interface ApprovedReleaseGrant {
  grantedAt: Date
  /**
   * When the broker MUST revoke the grant. TTL is broker-enforced: the broker
   * schedules `revokeApprovedRelease` to fire at (or before) this time. Permit
   * holds no timer of its own.
   */
  expiresAt: Date
  ttlSeconds: number
}

// The minimal slice of the permit role-assignment surface used here. Declared
// structurally so tests can inject a fake without the real SDK / PERMIT_API_KEY.
export interface RoleAssignmentClient {
  api: {
    roleAssignments: {
      assign(body: unknown): Promise<unknown>
      unassign(body: unknown): Promise<unknown>
    }
  }
  check(
    user: string,
    action: string,
    resource: { type: string; tenant: string; key?: string },
    context?: Record<string, unknown>
  ): Promise<boolean>
}

const defaultClient = permit as unknown as RoleAssignmentClient

/** Permit resource-instance id for an instance, e.g. "Secret:card_123". */
export function resourceInstanceId(resourceType: string, resourceKey: string): string {
  return `${resourceType}:${resourceKey}`
}

/**
 * Maps a sensitivity tier to the action a reader must hold:
 *   - LOW / MEDIUM  -> 'read'           (granted by the in-scope agent_reader)
 *   - HIGH          -> 'read_sensitive' (granted ONLY by approved_release)
 */
export function actionForSensitivity(
  sensitivity: Sensitivity
): 'read' | 'read_sensitive' {
  return sensitivity === 'HIGH' ? 'read_sensitive' : 'read'
}

function assignmentBody(ref: AgentScopeRef, role: string) {
  return {
    user: ref.agent,
    role,
    tenant: ref.tenant,
    resource_instance: resourceInstanceId(ref.resourceType, ref.resourceKey),
  }
}

/**
 * Grants an agent the in-scope `agent_reader` role on ONE resource instance.
 * This is the "agent is allowed to touch this secret at all" assignment. It
 * grants `read` (LOW/MEDIUM) but NOT `read_sensitive`.
 */
export async function assignAgentScope(
  ref: AgentScopeRef,
  client: RoleAssignmentClient = defaultClient
): Promise<boolean> {
  try {
    await client.api.roleAssignments.assign(assignmentBody(ref, AGENT_READER_ROLE))
    return true
  } catch (error) {
    console.error(
      `Error assigning agent scope (${AGENT_READER_ROLE}) for ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}:`,
      error
    )
    return false
  }
}

/** Revokes an agent's in-scope `agent_reader` role on a resource instance. */
export async function revokeAgentScope(
  ref: AgentScopeRef,
  client: RoleAssignmentClient = defaultClient
): Promise<boolean> {
  try {
    await client.api.roleAssignments.unassign(assignmentBody(ref, AGENT_READER_ROLE))
    return true
  } catch (error) {
    console.error(
      `Error revoking agent scope (${AGENT_READER_ROLE}) for ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}:`,
      error
    )
    return false
  }
}

/**
 * Assigns the time-boxed `approved_release` role on a resource instance AFTER a
 * human has approved a HIGH request. Returns the grant window. The caller (the
 * broker) MUST persist `expiresAt` and schedule `revokeApprovedRelease` to fire
 * at that time — Permit does not expire the assignment on its own.
 */
export async function grantApprovedRelease(
  ref: AgentScopeRef,
  ttlSeconds: number,
  client: RoleAssignmentClient = defaultClient
): Promise<ApprovedReleaseGrant | null> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    console.error(
      `Refusing to grant ${APPROVED_RELEASE_ROLE} with non-positive TTL (${ttlSeconds}s) for ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}`
    )
    return null
  }
  try {
    await client.api.roleAssignments.assign(
      assignmentBody(ref, APPROVED_RELEASE_ROLE)
    )
    const grantedAt = new Date()
    const expiresAt = new Date(grantedAt.getTime() + ttlSeconds * 1000)
    console.log(
      `Granted ${APPROVED_RELEASE_ROLE} to ${ref.agent} on ${ref.resourceType}:${ref.resourceKey} until ${expiresAt.toISOString()} (TTL ${ttlSeconds}s)`
    )
    return { grantedAt, expiresAt, ttlSeconds }
  } catch (error) {
    console.error(
      `Error granting ${APPROVED_RELEASE_ROLE} for ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}:`,
      error
    )
    return null
  }
}

/**
 * Revokes the time-boxed `approved_release` role. The broker calls this when the
 * TTL elapses (or to revoke early). Idempotent from the caller's perspective —
 * a no-op unassign simply returns true.
 */
export async function revokeApprovedRelease(
  ref: AgentScopeRef,
  client: RoleAssignmentClient = defaultClient
): Promise<boolean> {
  try {
    await client.api.roleAssignments.unassign(
      assignmentBody(ref, APPROVED_RELEASE_ROLE)
    )
    console.log(
      `Revoked ${APPROVED_RELEASE_ROLE} from ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}`
    )
    return true
  } catch (error) {
    console.error(
      `Error revoking ${APPROVED_RELEASE_ROLE} for ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}:`,
      error
    )
    return false
  }
}

/**
 * Authoritative read check for an agent against a single resource instance,
 * tier-aware. Picks `read` for LOW/MEDIUM and `read_sensitive` for HIGH, then
 * asks the PDP. Returns false (deny) on any error — fail safe.
 *
 * This is the entry point the worked example exercises:
 *   check(agent, "read_sensitive", card) denies until approved_release is
 *   assigned, allows for the TTL, then denies again after revocation.
 */
export async function checkAgentRead(
  ref: AgentScopeRef,
  sensitivity: Sensitivity,
  client: RoleAssignmentClient = defaultClient
): Promise<boolean> {
  const action = actionForSensitivity(sensitivity)
  try {
    return await client.check(ref.agent, action, {
      type: ref.resourceType,
      tenant: ref.tenant,
      key: ref.resourceKey,
    })
  } catch (error) {
    console.error(
      `Error checking ${action} for ${ref.agent} on ${ref.resourceType}:${ref.resourceKey}:`,
      error
    )
    return false
  }
}
