import { FuzeEvent, IdentityOrgDeletedPayloadV1 } from '@fuzefront/shared/kafka';
import { db } from '../db';
import { logger, timed } from '../lib/logger';

/**
 * Reacts to `identity.org.deleted` by cascading the deletion through all
 * selection-list-service tables that hold per-org data:
 *   access grants → audit rows → items → translations → lists → quota
 *
 * Cascade mode:
 *   'soft' — deactivate (set is_active=false on selection_lists; keep rows for audit)
 *   'hard' — purge (delete all rows, in foreign-key dependency order, in a transaction)
 *
 * Idempotent: an org with no selection lists is a no-op.
 */
export async function handleOrgDeleted(
  event: FuzeEvent<IdentityOrgDeletedPayloadV1>,
): Promise<void> {
  const { organizationId, cascade } = event.payload;
  // The event's correlationId is this thread's reqId so one event is one grep.
  const log = logger.child({ reqId: event.correlationId, component: 'org-deleted' });
  log.info({ organizationId, cascade }, 'identity.org.deleted received');

  const listCount = await timed(
    log,
    'db.count-org-lists',
    () => db('selection_lists').where({ org_id: organizationId }).count('id as n').first(),
    { organizationId },
  );
  if (!listCount || Number(listCount.n) === 0) {
    log.info({ organizationId }, 'org has no selection lists — nothing to cascade');
    return;
  }

  if (cascade === 'hard') {
    await db.transaction(async (trx) => {
      // 1. Delete access grants
      await trx('selection_list_access').where({ org_id: organizationId }).delete();
      // 2. Delete audit rows (referencing list IDs, not org directly — delete via subquery)
      const listIds = await trx('selection_lists').where({ org_id: organizationId }).pluck('id');
      if (listIds.length > 0) {
        await trx('selection_list_audit').whereIn('list_id', listIds).delete();
        // 3. Delete item translations
        const itemIds = await trx('selection_list_items').whereIn('list_id', listIds).pluck('id');
        if (itemIds.length > 0) {
          await trx('selection_list_item_translations').whereIn('item_id', itemIds).delete();
        }
        // 4. Delete list translations
        await trx('selection_list_translations').whereIn('list_id', listIds).delete();
        // 5. Delete items
        await trx('selection_list_items').whereIn('list_id', listIds).delete();
        // 6. Delete lists
        await trx('selection_lists').where({ org_id: organizationId }).delete();
      }
      // 7. Delete quota row
      await trx('selection_list_org_quota').where({ org_id: organizationId }).delete();
    });
    log.info({ organizationId }, 'hard-purged all selection-list data for org');
  } else {
    // Soft: deactivate lists (preserves audit trail)
    const updated = await db('selection_lists')
      .where({ org_id: organizationId, is_active: true })
      .update({ is_active: false, updated_at: new Date() });
    log.info({ organizationId, deactivated: Number(updated) }, 'soft-deactivated selection lists for org');
  }
}
