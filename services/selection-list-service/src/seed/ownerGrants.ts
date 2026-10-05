// seed/ownerGrants.ts - give the org owner `list-owner` on the org's platform-seeded lists
// (decision Q3 of docs/planning/selection-lists-events.md, overridden by the architect: the
// default "no instance grant" left seeded lists invisible, because the list endpoint filters
// per list by `SelectionList:read` and a tenant admin has no implicit ownership).
//
// WHEN. After `applyPlatformDefaults` has applied (or found already-applied) every pack, i.e.
// AFTER the seed transactions committed: the Security API grant is an external call and must
// never run inside, or be rolled back with, a seed transaction. Both `identity.org.created`
// and the reconciler reach it through `applyPlatformDefaults`, so there is one code path.
//
// WHO. `selection_list_ref_index.owner_id` (the `usr_...` wire id of
// `identity.org.created.ownerId`). Missing/NULL owner -> skip with a log + counter
// (`selection_list_seed_owner_grant_skipped_total{reason="no-owner"}`); seeding is never failed
// by it. App seed requests (`seed.requested`) are NOT granted here: the requesting app grants
// through the Security API itself (frozen event schemas carry no owner).
//
// HOW. Per list, in its own transaction: `grantListOwner(owner, org, list, SEED_PRINCIPAL, trx)` -
// the same fail-closed path as list creation (machine identity -> Security API grant ->
// `selection_list_access` mirror upsert) - plus a `seed.owner-granted` row in the audit trail,
// so the mirror row and its audit row commit together. A failure THROWS (the Kafka consumer
// retries the message / the reconciler backs the org off); lists already granted stay granted.
//
// IDEMPOTENT. Only lists with NO mirror row for the owner are granted, so a replay, a second
// consumer and the reconciler never grant twice - and a human's later decision survives: an owner
// who was demoted or had the grant revoked keeps a (changed / revoked) mirror row, which counts
// as "already decided" and is never re-granted. The Security API grant itself is an idempotent
// upsert, so a crash between it and the mirror write is healed by the retry.

import type { Knex } from 'knex';
import { PLATFORM_SEED_SOURCE } from '@fuzefront/shared/kafka';
import { grantListOwner } from '../middleware/authz';
import { mintEventId, wireOrgId } from '../events/outbox';
import { logger } from '../lib/logger';
import { ownerGrantSkippedTotal, ownerGrantsTotal } from '../lib/metrics';
import { readOrgProjection } from './org';
import { SEED_PRINCIPAL } from './types';

export interface EnsureSeededListOwnersOptions {
  /** Seam for tests; default is the production `grantListOwner` (machine identity, fail closed). */
  grantListOwner?: typeof grantListOwner;
  correlationId?: string;
}

export interface SeededListOwnerResult {
  /** Lists granted by THIS call. */
  granted: number;
  /** Set when the whole org was skipped. */
  skipped?: 'no-owner' | 'no-seeded-lists' | 'org-inactive';
}

/**
 * Ensure the org's owner holds `list-owner` on every active platform-seeded list of the org
 * (see the file header). Throws on a grant failure; returns what it did otherwise.
 */
export async function ensureSeededListOwners(
  db: Knex,
  organizationId: string,
  options: EnsureSeededListOwnersOptions = {},
): Promise<SeededListOwnerResult> {
  const org = wireOrgId(organizationId);
  const log = logger.child({ reqId: options.correlationId, component: 'seed-owner-grants', organizationId: org });
  const grant = options.grantListOwner ?? grantListOwner;

  const proj = await readOrgProjection(db, org);
  if (!proj || proj.status !== 'active' || proj.isActive === false) {
    ownerGrantSkippedTotal.inc({ reason: 'org-inactive' });
    log.debug('org is unknown, deleted or inactive: no owner grants');
    return { granted: 0, skipped: 'org-inactive' };
  }
  if (!proj.ownerId) {
    ownerGrantSkippedTotal.inc({ reason: 'no-owner' });
    log.info('org has no owner on record (identity.org.created.ownerId missing/null): seeded lists get no list-owner grant');
    return { granted: 0, skipped: 'no-owner' };
  }
  const owner = proj.ownerId;

  const pending = await pendingLists(db, org, owner);
  if (pending.length === 0) {
    ownerGrantSkippedTotal.inc({ reason: 'no-seeded-lists' });
    log.debug('no platform-seeded list is missing the owner grant');
    return { granted: 0, skipped: 'no-seeded-lists' };
  }

  let granted = 0;
  for (const row of pending) {
    try {
      await db.transaction(async (trx) => {
        await grant(owner, org, row.id, SEED_PRINCIPAL, trx);
        await trx('selection_list_audit').insert({
          id: mintEventId(),
          list_id: row.id,
          item_id: null,
          actor_id: SEED_PRINCIPAL,
          action: 'seed.owner-granted',
          before: null,
          after: trx.raw('?::jsonb', [JSON.stringify({ seedSource: PLATFORM_SEED_SOURCE, role: 'list-owner', userId: owner, listId: row.id, listKey: row.seed_list_key })]),
        });
      });
      granted += 1;
      ownerGrantsTotal.inc({ result: 'granted' });
    } catch (err) {
      ownerGrantsTotal.inc({ result: 'failed' });
      log.warn({ err, listId: row.id, granted }, 'list-owner grant for the org owner failed; the consumer / reconciler will retry');
      throw err;
    }
  }
  log.info({ granted }, 'org owner granted list-owner on the platform-seeded lists');
  return { granted };
}

interface PendingList {
  id: string;
  seed_list_key: string | null;
}

/** Active platform-seeded lists of the org that have no access-mirror row (any role, revoked or not) for the owner. */
async function pendingLists(ex: Knex | Knex.Transaction, org: string, owner: string): Promise<PendingList[]> {
  const res = await ex.raw(
    `SELECT l.id, l.seed_list_key
       FROM selection_lists l
      WHERE l.organization_id = ?
        AND l.seed_source = ?
        AND l.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM selection_list_access a WHERE a.list_id = l.id AND a.user_id = ?)
      ORDER BY l.id`,
    [org, PLATFORM_SEED_SOURCE, owner],
  );
  return res.rows as PendingList[];
}

/** SQL fragment (for the reconciler): org `r` has an owner and a platform-seeded list still missing their grant. */
export const OWNER_GRANT_PENDING_SQL = `(r.owner_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM selection_lists sl
     WHERE sl.organization_id = r.wire_id AND sl.seed_source = '${PLATFORM_SEED_SOURCE}' AND sl.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM selection_list_access a WHERE a.list_id = sl.id AND a.user_id = r.owner_id)))`;
