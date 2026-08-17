import { db as defaultDb } from '../config/database'
import {
  syncUserToPermit,
  deleteUserFromPermit,
} from '../utils/permit/user-sync'
import type { Knex } from 'knex'

/**
 * User-lifecycle reconciliation — the consumer-facing mirror of the identity
 * user events. provisioning-service calls the internal endpoints backed by
 * these functions when it observes `identity.user.updated` / `.deleted`, so a
 * user's external state (Permit principal, sessions) stays consistent with the
 * owning identity service without that service reaching across the boundary.
 *
 * Both operations are best-effort + idempotent: a re-delivered event or an
 * unknown user is a safe no-op, never an error.
 */

/** Externals injected for testing (no real Permit cloud / DB needed). */
export interface UserLifecycleDeps {
  db: Knex
}

function getDeps(overrides?: Partial<UserLifecycleDeps>): UserLifecycleDeps {
  return {
    db: overrides?.db ?? defaultDb,
  }
}

export interface SyncUserProfileInput {
  userId: string
  email: string
  firstName?: string
  lastName?: string
}

export interface SyncUserProfileResult {
  userId: string
  permitSynced: boolean
}

/**
 * Re-syncs a user's profile into Permit from the fields carried on
 * `identity.user.updated`. Best-effort: a Permit failure is logged and
 * reflected in `permitSynced`, not thrown.
 */
export async function syncUserProfile(
  input: SyncUserProfileInput
): Promise<SyncUserProfileResult> {
  const permitSynced = await syncUserToPermit({
    id: input.userId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: [],
  } as any)

  return { userId: input.userId, permitSynced }
}

export interface DeprovisionUserResult {
  userId: string
  cascade: 'soft' | 'hard'
  permitDeleted: boolean
  sessionsRevoked: number
}

/**
 * Tears down a user's external state on `identity.user.deleted`: deletes the
 * Permit principal and revokes the user's sessions (hard-deleted, cf.
 * `routes/auth.ts` sign-out). Both `soft` and `hard` cascades revoke access;
 * they differ only in intent upstream. Idempotent — safe for an unknown user
 * (0 sessions removed, Permit delete is a no-op).
 */
export async function deprovisionUser(
  userId: string,
  cascade: 'soft' | 'hard',
  overrides?: Partial<UserLifecycleDeps>
): Promise<DeprovisionUserResult> {
  const { db } = getDeps(overrides)

  const permitDeleted = await deleteUserFromPermit(userId)

  const sessionsRevoked = await db('sessions')
    .where({ user_id: userId })
    .del()

  return {
    userId,
    cascade,
    permitDeleted,
    sessionsRevoked: Number(sessionsRevoked) || 0,
  }
}
