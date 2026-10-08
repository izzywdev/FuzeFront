import { FuzeEvent, IdentityOrgDeletedPayloadV1 } from '@fuzefront/shared/kafka';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { db } from '../db';
import { logger, timed } from '../lib/logger';
import { markOrgProjectionDeleted } from './orgProjection';

/**
 * The stored `organization_id` is TEXT and is whatever the caller's token
 * carried, which on the wire is a TypeID (`org_…`, openapi `OrganizationId`),
 * while `identity.org.deleted` carries the bare UUID (shared schema:
 * `organizationId: z.string().uuid()`). The two are renderings of one value
 * (identity codec), so match BOTH — otherwise a prefixed-id deployment would
 * silently never match a row.
 */
function orgIdForms(organizationId: string): string[] {
  const forms = new Set<string>([organizationId]);
  try {
    forms.add(fromUuid('organization', organizationId));
  } catch {
    // Not a UUID (the event schema guarantees one, but a handler must not throw
    // on a shape it can still match literally).
  }
  return [...forms];
}

/**
 * Reacts to `identity.org.deleted` by cascading the deletion through all
 * selection-list-service tables that hold per-org data:
 *   access grants → audit rows → items → translations → lists → quota → seed ledger (hard only)
 *
 * Column truth (src/db/migrations): selection_lists.organization_id / .status
 * ('active' | 'archived'); selection_list_org_quota.organization_id;
 * selection_list_access has NO organization_id (a nullable, denormalised
 * `org_id` exists since migration 5 but is not reliable) so access rows are
 * removed by list_id. There is NO `is_active` column anywhere — the earlier
 * version of this handler queried `org_id`/`is_active` and threw on every event
 * (review M-3 / rollout blocker B7).
 *
 * Cascade mode:
 *   'soft' — archive (set status='archived' on the org's active lists; keep every
 *            row for audit and for a later restore)
 *   'hard' — purge (delete all rows, in foreign-key dependency order, in ONE
 *            transaction; also removes the org's quota override row)
 *
 * BEFORE cascading, the org is tombstoned in the org projection (`selection_list_ref_index`,
 * plan section 7.1): the seed algorithm refuses a deleted org with ORG_INACTIVE, so a late
 * `identity.org.created` / `seed.requested` can never resurrect lists in a deleted org. The
 * tombstone is written even for an org never seen (delete-before-create) and is never reverted.
 *
 * Idempotent: replaying the same event is a no-op (soft: nothing left 'active';
 * hard: nothing left to delete). Never touches the DLQ — a failure is thrown to
 * the consumer loop, success returns normally.
 */
export async function handleOrgDeleted(
  event: FuzeEvent<IdentityOrgDeletedPayloadV1>,
): Promise<void> {
  const { organizationId, cascade } = event.payload;
  const orgIds = orgIdForms(organizationId);
  // The event's correlationId is this thread's reqId so one event is one grep.
  const log = logger.child({ reqId: event.correlationId, component: 'org-deleted' });
  log.info({ organizationId, cascade }, 'identity.org.deleted received');

  // Tombstone the projection FIRST (infra faults throw -> the message is retried).
  await timed(log, 'db.tombstone-org-projection', () => markOrgProjectionDeleted(db, organizationId), { organizationId });

  if (cascade === 'hard') {
    const removed = await timed(
      log,
      'db.hard-purge-org',
      () =>
        db.transaction(async (trx) => {
          const listIds: string[] = await trx('selection_lists').whereIn('organization_id', orgIds).pluck('id');
          if (listIds.length > 0) {
            // 1. Access grants — by list_id, not org_id: access.org_id is nullable
            //    (migration 5), and a stray row would block the list delete
            //    (FK ON DELETE RESTRICT).
            await trx('selection_list_access').whereIn('list_id', listIds).delete();
            const itemIds: string[] = await trx('selection_list_items').whereIn('list_id', listIds).pluck('id');
            // 2. Audit rows — by list_id AND by item_id (an item-level row could
            //    reference an item without a list_id; either FK would block step 5/6).
            await trx('selection_list_audit').whereIn('list_id', listIds).delete();
            if (itemIds.length > 0) {
              await trx('selection_list_audit').whereIn('item_id', itemIds).delete();
              // 3. Item translations
              await trx('selection_list_item_translations').whereIn('item_id', itemIds).delete();
            }
            // 4. List translations
            await trx('selection_list_translations').whereIn('list_id', listIds).delete();
            // 5. Items
            await trx('selection_list_items').whereIn('list_id', listIds).delete();
            // 6. Lists
            await trx('selection_lists').whereIn('organization_id', orgIds).delete();
          }
          // 7. Quota override row (independent of whether any list remains)
          await trx('selection_list_org_quota').whereIn('organization_id', orgIds).delete();
          // 8. Seed ledger (plan section 13: the HARD purge deletes the org's ledger rows; the soft
          //    cascade keeps them so a restore does not re-seed). Independent of whether any list remains.
          await trx('selection_list_seed_ledger').whereIn('organization_id', orgIds).delete();
          return listIds.length;
        }),
      { organizationId },
    );
    if (removed === 0) {
      log.info({ organizationId }, 'org has no selection lists — nothing to purge (quota row cleared if present)');
    } else {
      log.info({ organizationId, lists: removed }, 'hard-purged all selection-list data for org');
    }
    return;
  }

  // Soft: archive the org's lists (preserves the audit trail and the data).
  const archived = await timed(
    log,
    'db.soft-archive-org-lists',
    () =>
      db('selection_lists')
        .whereIn('organization_id', orgIds)
        .where({ status: 'active' })
        .update({ status: 'archived', updated_at: new Date() }),
    { organizationId },
  );
  if (Number(archived) === 0) {
    log.info({ organizationId }, 'org has no active selection lists — nothing to archive');
    return;
  }
  log.info({ organizationId, archived: Number(archived) }, 'soft-archived selection lists for org');
}
