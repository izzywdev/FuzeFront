import { FuzeEvent, IdentityUserDeletedPayloadV1 } from '@fuzefront/shared/kafka';
import { db } from '../db';

/**
 * Reacts to `identity.user.deleted` by anonymizing per-user authorship
 * references in selection-list-service tables. The service uses `created_by`
 * and `granted_by` columns (plain TEXT, not FK-enforced) that reference user IDs.
 *
 * Cascade mode:
 *   'soft' — replace the user id with the sentinel '[deleted-user]' (audit trail preserved)
 *   'hard' — same behaviour; selection-list-service has no user-scoped rows to purge
 *             (all data is org-scoped), so hard and soft are equivalent here.
 *
 * Idempotent: if the user id is not present in any row the operation is a no-op.
 */
export async function handleUserDeleted(
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
): Promise<void> {
  const { userId } = event.payload;
  const sentinel = '[deleted-user]';

  const [lists, items, access] = await Promise.all([
    db('selection_lists').where({ created_by: userId }).update({ created_by: sentinel }),
    db('selection_list_items').where({ created_by: userId }).update({ created_by: sentinel }),
    db('selection_list_access').where({ granted_by: userId }).update({ granted_by: sentinel }),
  ]);

  const total = Number(lists) + Number(items) + Number(access);
  if (total === 0) {
    console.log(
      '[selection-list-service] user %s has no authorship references — nothing to anonymize (correlationId=%s)',
      userId,
      event.correlationId,
    );
    return;
  }

  console.log(
    '[selection-list-service] anonymized user %s in %d row(s) (lists=%d items=%d access=%d, correlationId=%s)',
    userId,
    total,
    lists,
    items,
    access,
    event.correlationId,
  );
}
