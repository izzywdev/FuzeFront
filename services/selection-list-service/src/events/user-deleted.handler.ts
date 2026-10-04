import { FuzeEvent, IdentityUserDeletedPayloadV1 } from '@fuzefront/shared/kafka';
import { db } from '../db';
import { logger, timed } from '../lib/logger';

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
  // The event's correlationId is this thread's reqId so one event is one grep.
  const log = logger.child({ reqId: event.correlationId, component: 'user-deleted' });
  log.info({ userId }, 'identity.user.deleted received');

  const [lists, items, access] = await timed(
    log,
    'db.anonymize-user',
    () =>
      Promise.all([
        db('selection_lists').where({ created_by: userId }).update({ created_by: sentinel }),
        db('selection_list_items').where({ created_by: userId }).update({ created_by: sentinel }),
        db('selection_list_access').where({ granted_by: userId }).update({ granted_by: sentinel }),
      ]),
    { userId },
  );

  const total = Number(lists) + Number(items) + Number(access);
  if (total === 0) {
    log.info({ userId }, 'user has no authorship references — nothing to anonymize');
    return;
  }

  log.info({ userId, total, lists: Number(lists), items: Number(items), access: Number(access) }, 'anonymized user authorship references');
}
