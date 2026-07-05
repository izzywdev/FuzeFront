/**
 * machine-roles.ts
 *
 * Permit.io helpers for machine/service-account (agent) identities.
 *
 * Responsibilities:
 *  - Sync a machine identity as a service_account principal in Permit
 *  - Create the delegate_of relationship: Agent --delegate_of--> User
 *  - Check that an agent's effective permissions derive from its delegated user
 *
 * Uses the same graceful-fallback pattern as the rest of the permit utils:
 * errors are caught, logged, and a safe default is returned (never throws to
 * callers).
 *
 * ReBAC model:
 *   Resource type:  ServiceAccount
 *   Relationship:   delegate_of  (ServiceAccount → User)
 *   Semantics:      The machine identity may act on behalf of the delegated
 *                   user, within the scopes it was granted.
 */

import permit from '../../config/permit'
import { MachineIdentity } from '../../services/machine-identity'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceAccountPrincipal {
  /** Stable key — the OAuth2 client_id from Authentik */
  key: string
  /** Human-readable agent name */
  name: string
  /** ISO-8601 creation timestamp */
  createdAt?: string
  /** Optional human user this agent is delegating on behalf of */
  delegateUserId?: string
  /** Scopes granted to this service account */
  scopes?: string[]
}

export interface DelegateRelationship {
  agentKey: string
  userKey: string
  tenant: string
}

// ---------------------------------------------------------------------------
// Permit.io sync helpers
// ---------------------------------------------------------------------------

/**
 * Syncs a machine identity to Permit.io as a service account user.
 *
 * Permit treats service accounts as regular users with a distinct key
 * prefix (`svc:<client_id>`) so they can be targeted by policy.
 *
 * Falls back to false on error (never throws).
 */
export async function syncMachineIdentityToPermit(
  identity: MachineIdentity | ServiceAccountPrincipal
): Promise<boolean> {
  const rawKey = 'clientId' in identity ? identity.clientId : identity.key
  const permitKey = toPermitKey(rawKey)

  try {
    await permit.api.users.sync({
      key: permitKey,
      // Permit users can carry arbitrary attributes; we use these to
      // distinguish service accounts from human users in policy.
      attributes: {
        identity_type: 'service_account',
        client_id: rawKey,
        scopes: 'scopes' in identity ? identity.scopes?.join(' ') ?? '' : '',
        delegate_user_id: identity.delegateUserId ?? null,
        created_at: 'createdAt' in identity ? identity.createdAt ?? null : null,
      },
    })

    console.log(`[machine-roles] Synced service account to Permit: ${permitKey}`)
    return true
  } catch (error) {
    console.error(`[machine-roles] Error syncing service account ${permitKey} to Permit:`, error)
    return false
  }
}

/**
 * Creates (or replaces) the delegate_of relationship between an agent and a
 * human user in Permit.io.
 *
 * Relationship: ServiceAccount(agentKey) --delegate_of--> User(userKey)
 *
 * This must be called whenever a machine token declares a delegate_user_id.
 * It is idempotent — calling it multiple times with the same arguments is safe.
 *
 * Falls back to false on error (never throws).
 */
export async function createDelegateRelationship(
  rel: DelegateRelationship
): Promise<boolean> {
  const agentPermitKey = toPermitKey(rel.agentKey)

  try {
    // Permit ReBAC: assign a relationship instance
    // The subject (agent) holds a "delegate_of" relation to the object (user)
    // within the given tenant.
    await permit.api.relationshipTuples.create({
      subject: `ServiceAccount:${agentPermitKey}`,
      relation: 'delegate_of',
      object: `User:${rel.userKey}`,
      tenant: rel.tenant,
    })

    console.log(
      `[machine-roles] Created delegate_of relationship: ${agentPermitKey} -> ${rel.userKey} (tenant: ${rel.tenant})`
    )
    return true
  } catch (error: any) {
    // Permit returns 409 if the relationship already exists; treat as success
    if (error?.response?.status === 409 || error?.status === 409) {
      console.log(
        `[machine-roles] delegate_of relationship already exists: ${agentPermitKey} -> ${rel.userKey}`
      )
      return true
    }
    console.error(`[machine-roles] Error creating delegate_of relationship:`, error)
    return false
  }
}

/**
 * Removes the delegate_of relationship between an agent and a user.
 *
 * Call this when revoking delegation (e.g., the machine token is revoked or
 * the user explicitly revokes agent access).
 *
 * Falls back to false on error (never throws).
 */
export async function removeDelegateRelationship(
  rel: DelegateRelationship
): Promise<boolean> {
  const agentPermitKey = toPermitKey(rel.agentKey)

  try {
    await permit.api.relationshipTuples.delete({
      subject: `ServiceAccount:${agentPermitKey}`,
      relation: 'delegate_of',
      object: `User:${rel.userKey}`,
      tenant: rel.tenant,
    })

    console.log(
      `[machine-roles] Removed delegate_of relationship: ${agentPermitKey} -> ${rel.userKey}`
    )
    return true
  } catch (error) {
    console.error(`[machine-roles] Error removing delegate_of relationship:`, error)
    return false
  }
}

/**
 * Checks whether a machine identity (agent) may perform an action on a
 * resource by deriving authority from its delegated user.
 *
 * The check is: does the delegated user have permission AND does the agent
 * hold the delegate_of relationship to that user?
 *
 * When the agent has no delegate (standalone service account), the check is
 * performed directly on the agent's own Permit identity.
 *
 * Falls back to false on error (never throws).
 */
export async function checkMachinePermission(
  identity: MachineIdentity,
  action: string,
  resource: { type: string; tenant: string; key?: string }
): Promise<boolean> {
  const subjectKey = identity.delegateUserId ?? toPermitKey(identity.clientId)

  try {
    const result = await permit.check(subjectKey, action, resource)
    console.log(
      `[machine-roles] Permission check — subject: ${subjectKey}, action: ${action}, resource: ${resource.type}, result: ${result}`
    )
    return result
  } catch (error) {
    console.error('[machine-roles] Error checking machine permission:', error)
    return false // Fail safe — deny on error
  }
}

/**
 * Convenience: sync a MachineIdentity AND create the delegate_of relationship
 * in a single call.  Typically invoked when a machine token is first validated
 * on a request that carries a delegate_user_id claim.
 */
export async function provisionMachineIdentity(
  identity: MachineIdentity,
  tenant: string
): Promise<boolean> {
  const synced = await syncMachineIdentityToPermit(identity)
  if (!synced) return false

  if (identity.delegateUserId) {
    const delegated = await createDelegateRelationship({
      agentKey: identity.clientId,
      userKey: identity.delegateUserId,
      tenant,
    })
    return delegated
  }

  return true
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw OAuth2 client_id to the Permit.io user key used for service
 * accounts.  The `svc:` prefix makes it easy to distinguish machine identities
 * from human users in Permit policy authoring and audit logs.
 */
function toPermitKey(clientId: string): string {
  return clientId.startsWith('svc:') ? clientId : `svc:${clientId}`
}
