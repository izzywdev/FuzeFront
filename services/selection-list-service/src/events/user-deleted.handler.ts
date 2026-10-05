import { FuzeEvent, IdentityUserDeletedPayloadV1, TOPICS } from '@fuzefront/shared/kafka';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import type { Logger } from 'pino';
import { db } from '../db';
import { logger, timed } from '../lib/logger';
import { getAuthzClient, SELECTION_LIST_RESOURCE } from '../middleware/authz';
import { getGrantToken } from '../lib/machineIdentity';
import { hasConfirmedOtherOwner } from '../services/authority';
import { grantCleanupFailedTotal, ownerlessListsTotal } from '../lib/metrics';
import { emitAccessRevoked, systemEventContext } from './emitters';
import { lockOrgOutbox, wireUserId } from './outbox';
import { RetryBudget } from './retryBudget';

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
 * ALSO revokes the deleted user's own list grants (review M-2): for every
 * `selection_list_access` row of the user, the Security API assignment on
 * `SelectionList:<id>` is revoked with this service's machine identity (the
 * authority first), then the mirror row is deleted and `access.revoked` is
 * written through the outbox, all in one transaction per list. See
 * `revokeDeletedUserGrants` for the ownerless-list fallback and the retry rules.
 *
 * Cascade mode:
 *   'soft' — replace the user id with the sentinel '[deleted-user]' (audit trail preserved)
 *   'hard' — same behaviour; selection-list-service has no user-scoped rows to purge
 *             (all data is org-scoped), so hard and soft are equivalent here.
 *
 * Idempotent: if the user id is not present in any row the operation is a no-op.
 */
export interface UserDeletedDeps {
  /** Park an event on `<topic>.dlq` once the retry budget is spent (wired by the consumer). */
  deadLetter?: (topic: string, envelope: unknown, reason: string) => Promise<void>;
  budget?: RetryBudget;
}

const defaultBudget = new RetryBudget();

export async function handleUserDeleted(
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
  deps: UserDeletedDeps = {},
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
  } else {
    log.info({ userId, total, lists: Number(lists), items: Number(items), access: Number(access) }, 'anonymized user authorship references');
  }

  // Anonymisation above is idempotent and already committed; the grant cleanup
  // below is what can fail and be retried.
  const budget = deps.budget ?? defaultBudget;
  const budgetKey = `user-deleted:${userId}`;
  const failed = await revokeDeletedUserGrants(userIds, event, log);
  if (failed === 0) {
    budget.clear(budgetKey);
    return;
  }

  // A throw is retried by kafkajs (same message, backoff): right for a Security
  // API blip, wrong forever for a deterministic fault. The attempt that spends
  // the budget parks the event on the DLQ (when the consumer wired one) and
  // returns so the partition is not wedged; the failed grants are logged and
  // counted for reconciliation.
  const { attempt, last } = budget.next(budgetKey);
  const reason = `${failed} grant revocation(s) failed for deleted user`;
  if (!last || !deps.deadLetter) {
    log.warn({ userId, failed, attempt }, 'user-deleted: grant cleanup incomplete — retrying');
    throw new Error(`user-deleted: ${reason}`);
  }
  log.error({ userId, failed, attempt }, 'user-deleted: grant cleanup incomplete and the retry budget is spent — dead-lettering');
  budget.clear(budgetKey);
  await deps.deadLetter(TOPICS.IDENTITY_USER_DELETED, event, reason);
}

/**
 * Revoke every Security API grant the deleted user holds on a selection list and
 * delete their mirror rows. Returns the number of lists whose cleanup FAILED
 * (0 = done); a failed list is left intact in the mirror so a retry resumes
 * exactly where it stopped. Idempotent: the Security API treats revoking an
 * absent assignment as success, and a re-run finds no mirror rows to process.
 *
 * Authority first, then mirror, one transaction per list under the org outbox
 * lock + the list's access-row lock (the same order as routes/access.ts). The
 * mirror row is HARD-deleted, soft and hard cascades alike: it identifies a user
 * who no longer exists, and nothing else in the service keeps the id.
 *
 * LAST OWNER (the fallback). If the user is the list's last confirmed owner, the
 * grant is revoked anyway. A deleted principal must not keep a role (the id is
 * stale, and a ghost owner is not an owner), and refusing would wedge the event.
 * What we do instead is NOT hide it: the list is logged at ERROR with
 * `ownerless: true`, `selection_list_ownerless_lists_total{cause="user_deleted"}`
 * is incremented (alert on any increase), and recovery is a tenant admin
 * granting `list-owner` on the instance through the Security API
 * (`POST /authz/grants`; the human grant gate allows `Organization:manage`),
 * as documented in docs/runbooks/selection-lists-seeding-operations.md.
 */
export async function revokeDeletedUserGrants(
  userIds: string[],
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
  log: Logger,
): Promise<number> {
  const placeholders = userIds.map(() => '?').join(', ');
  const found = await db.raw<{
    rows?: Array<{ list_id: string; user_id: string; role: string; organization_id: string }>;
  }>(
    `SELECT a.list_id, a.user_id, a.role, l.organization_id
       FROM selection_list_access a
       JOIN selection_lists l ON l.id = a.list_id
      WHERE a.user_id IN (${placeholders})`,
    userIds,
  );
  const rows = found?.rows ?? [];
  if (rows.length === 0) return 0;

  // Without the machine identity nothing can be revoked: throw (retry / DLQ),
  // never silently skip — a deleted user must not keep list access.
  const token = await getGrantToken();

  let failed = 0;
  for (const row of rows) {
    const rowLog = log.child({ listId: row.list_id, orgId: row.organization_id });
    try {
      await db.transaction(async (trx) => {
        await lockOrgOutbox(trx, row.organization_id);
        await trx('selection_list_access').where({ list_id: row.list_id }).forUpdate().select('user_id');
        const current = await trx('selection_list_access')
          .where({ list_id: row.list_id, user_id: row.user_id })
          .first('role', 'revoked_at');
        if (!current) return; // another run already removed it

        const active = current['revoked_at'] == null;
        let ownerless = false;
        if (active) {
          if (current['role'] === 'list-owner') {
            const another = await hasConfirmedOtherOwner({
              executor: trx,
              listId: row.list_id,
              orgId: row.organization_id,
              excludeUserIds: [...userIds, row.user_id],
              token,
              log: rowLog,
            });
            ownerless = !another;
          }
          await getAuthzClient().revoke(
            {
              subject: row.user_id,
              tenant: row.organization_id,
              role: current['role'] as string,
              resource: { type: SELECTION_LIST_RESOURCE, key: row.list_id },
            },
            token,
          );
        }

        await trx('selection_list_access').where({ list_id: row.list_id, user_id: row.user_id }).delete();

        if (active) {
          try {
            await emitAccessRevoked(
              trx,
              systemEventContext(row.organization_id, null, event.correlationId),
              row.list_id,
              { userId: wireUserId(row.user_id), role: current['role'] as string },
            );
          } catch (err) {
            // A stored id that is not a wire-renderable user id cannot be announced;
            // the revocation itself stands. (Schema/outbox faults still roll back below.)
            if ((err as { name?: string }).name !== 'WireIdError') throw err;
            rowLog.warn({ err }, 'user-deleted: stored user id is not wire-renderable — access.revoked not emitted');
          }
        }

        if (ownerless) {
          ownerlessListsTotal.inc({ cause: 'user_deleted' });
          rowLog.error(
            { ownerless: true, role: 'list-owner', cause: 'user_deleted' },
            'user-deleted: the deleted user was the list\'s last owner — the list now has NO list-owner; a tenant admin must grant list-owner via the Security API',
          );
        }
      });
    } catch (err) {
      failed++;
      grantCleanupFailedTotal.inc({ cause: 'user_deleted' });
      rowLog.warn({ err, role: row.role }, 'user-deleted: could not revoke this grant (left in the mirror for the retry)');
    }
  }
  return failed;
}
