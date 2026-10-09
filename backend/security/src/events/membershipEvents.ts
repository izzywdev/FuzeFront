import type { Knex } from 'knex'
import { enqueueEvent } from '@fuzefront/core'
import { TOPICS } from '@fuzefront/shared/kafka'
import { v4 as uuidv4 } from 'uuid'

export interface MembershipChange {
  organizationId: string
  userId: string
  role: string
}

export type MembershipAuthorizationChange =
  | 'membership_added'
  | 'membership_removed'
  | 'membership_role_changed'

/**
 * Emit a cache-invalidation signal alongside a membership mutation.  This is
 * not a policy export: policy/grant data stays behind FuzeFront's authz API.
 */
export async function emitAuthorizationChanged(
  trx: Knex.Transaction,
  c: MembershipChange,
  change: MembershipAuthorizationChange,
  includeRole = true
): Promise<void> {
  await enqueueEvent(
    trx,
    TOPICS.IDENTITY_AUTHORIZATION_CHANGED,
    {
      organizationId: c.organizationId,
      subjectId: c.userId,
      change,
      ...(includeRole ? { role: c.role } : {}),
    },
    `identity-authorization-changed-${uuidv4()}`
  )
}

/**
 * Enqueue an `identity.membership.added` event on the transactional outbox.
 * MUST be called with the same transaction that performs the membership
 * insert so the event commits atomically with the write.
 */
export async function emitMembershipAdded(
  trx: Knex.Transaction,
  c: MembershipChange
): Promise<void> {
  await enqueueEvent(
    trx,
    TOPICS.IDENTITY_MEMBERSHIP_ADDED,
    { organizationId: c.organizationId, userId: c.userId, role: c.role },
    `identity-membership-added-${uuidv4()}`
  )
  await emitAuthorizationChanged(trx, c, 'membership_added')
}

/**
 * Enqueue an `identity.membership.removed` event on the transactional outbox.
 * MUST be called with the same transaction that performs the membership delete.
 */
export async function emitMembershipRemoved(
  trx: Knex.Transaction,
  c: MembershipChange
): Promise<void> {
  await enqueueEvent(
    trx,
    TOPICS.IDENTITY_MEMBERSHIP_REMOVED,
    { organizationId: c.organizationId, userId: c.userId, role: c.role },
    `identity-membership-removed-${uuidv4()}`
  )
  await emitAuthorizationChanged(trx, c, 'membership_removed', false)
}
