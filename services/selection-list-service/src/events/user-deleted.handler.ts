import { FuzeEvent, IdentityUserDeletedPayloadV1 } from '@fuzefront/shared/kafka';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { db } from '../db';
import { logger, timed } from '../lib/logger';

/**
 * Stored user ids are TEXT as the token/API carried them — `usr_…` TypeIDs on the
 * wire (openapi `UserId`; routes/access.ts requires the prefix) — while
 * `identity.user.deleted` carries the bare UUID (shared schema). The two are
 * renderings of one value (identity codec): match BOTH, or a prefixed-id
 * deployment never matches a row.
 */
function userIdForms(userId: string): string[] {
  const forms = new Set<string>([userId]);
  try {
    forms.add(fromUuid('user', userId));
  } catch {
    // Not a UUID: match it literally only.
  }
  return [...forms];
}

/**
 * Reacts to `identity.user.deleted` by anonymizing per-user authorship
 * references in selection-list-service tables. Verified against the migrations:
 * `selection_lists.created_by`, `selection_list_items.created_by` and
 * `selection_list_access.granted_by` all exist (plain TEXT, NOT NULL, not
 * FK-enforced) and reference user IDs.
 *
 * NOT done here (review M-2, tracked separately): revoking the deleted user's
 * own grants (`selection_list_access.user_id`) in the Security API / mirror.
 * That needs the machine identity and an org-admin fallback for last owners.
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
  const userIds = userIdForms(userId);
  const sentinel = '[deleted-user]';
  // The event's correlationId is this thread's reqId so one event is one grep.
  const log = logger.child({ reqId: event.correlationId, component: 'user-deleted' });
  log.info({ userId }, 'identity.user.deleted received');

  const [lists, items, access] = await timed(
    log,
    'db.anonymize-user',
    () =>
      Promise.all([
        db('selection_lists').whereIn('created_by', userIds).update({ created_by: sentinel }),
        db('selection_list_items').whereIn('created_by', userIds).update({ created_by: sentinel }),
        db('selection_list_access').whereIn('granted_by', userIds).update({ granted_by: sentinel }),
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
