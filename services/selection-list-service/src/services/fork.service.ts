// services/fork.service.ts — copy-on-write fork of a common list (design record D6 and section 6).
//
// ONE transaction does everything that is state of THIS service:
//   1. org outbox lock (the lock order of every writer: org outbox lock -> quota lock -> list rows);
//   2. idempotency: a fork of (this org, this source) already exists => nothing is copied (`exists`);
//   3. the source is re-read `FOR SHARE` (it must still be a common list; its revision and items are then
//      a consistent snapshot: a concurrent writer of the source waits for this commit);
//   4. quotas under the advisory lock: org_lists / user_lists / list storage, list_items, list_locales;
//   5. the list row (minted id, same key, `forked_from_*`, `seed: null`, created_by = the caller), the list
//      translations, every non-purged item (ACTIVE and ARCHIVED, so stored ids keep a mapping) under a
//      NEW minted id with `origin_item_id`, and every item translation (is_machine / source_hash kept);
//   6. the caller becomes `list-owner` on the fork with the service's MACHINE identity — the very same
//      `grantListOwner` that create uses (scope selection-list:owner-grant; nothing is widened);
//   7. the events, through the transactional outbox (emitForkEvents).
//
// The Security API grant (6) is not part of the database transaction: if anything after it fails, the route
// compensates (restoreAuthority) so no role assignment is left on a list that never existed.
//
// Ids: the service mints the fork id (the route) and every item id (here); nothing is accepted from the client.

import { mintId } from '@izzywdev/fuzefront-identity';
import { db } from '../db';
import { grantListOwner } from '../middleware/authz';
import { emitForkEvents, EventContext } from '../events/emitters';
import { lockOrgOutbox, wireOrgId, wireUserId } from '../events/outbox';
import { canonicalOrgId, orgForms, sameOrg } from '../lib/sharedLists';
import { checkForkQuota, checkListQuota, lockQuotaScope } from './quota.service';

/** Hard bound on the items of a fork source: the bound of the `list.forked` itemMap (shared 1.3.0). */
export const FORK_MAX_ITEMS = 5000;

const ITEM_INSERT_CHUNK = 500;
const ITEM_TRANSLATION_INSERT_CHUNK = 1000;

export type ForkOutcome =
  | { kind: 'created'; eventCount: number; itemCount: number }
  /** the organization already holds a fork of this source (any status) */
  | { kind: 'exists'; listId: string }
  /** the source vanished, or is no longer a common list, between the route's check and the lock */
  | { kind: 'source-gone' }
  /** the source belongs to the caller's own organization */
  | { kind: 'own-org' }
  | { kind: 'too-large'; items: number }
  /** a DIFFERENT list of the organization already uses the key */
  | { kind: 'key-taken' };

export interface ForkInput {
  /** The service-minted id of the fork (minted by the route so it can compensate by id). */
  forkId: string;
  orgId: string;
  userId: string;
  sourceId: string;
  visibility: 'org' | 'private';
  ctx: EventContext;
  /** The wire id of the platform organization (the only org whose common lists are forkable). */
  platformOrg: string;
  /** Called immediately BEFORE the Security API grant is attempted (the route uses it to know it must compensate). */
  onGrantAttempt: () => void;
}

interface SourceRow {
  id: string;
  organization_id: string;
  key: string;
  source_locale: string;
  status: string;
  revision: string | number;
  visibility: string;
}

export async function forkList(input: ForkInput): Promise<ForkOutcome> {
  const { forkId, orgId, userId, sourceId, ctx } = input;

  // The org claim is passed verbatim by the auth middleware and may be a bare UUID or the org_ TypeID of the SAME
  // organization. Every check that decides idempotency / key ownership matches ALL renderings, and the quota
  // lock is taken on the canonical form, so one org cannot fork (or take a key) once per representation. The
  // row itself is stored under the caller's own rendering, like every list of this service.
  const orgKey = canonicalOrgId(orgId) ?? orgId;
  const orgRenderings = [...new Set([orgId, ...orgForms(orgKey)])];

  return db.transaction(async (trx): Promise<ForkOutcome> => {
    await lockOrgOutbox(trx, orgId);

    // 2. idempotency
    const existing = await trx.raw(
      `SELECT id FROM selection_lists WHERE organization_id = ANY(?) AND forked_from_list_id = ?`,
      [orgRenderings, sourceId],
    );
    const already = (existing as { rows?: Array<{ id: string }> }).rows?.[0];
    if (already) return { kind: 'exists', listId: already.id };

    // 4a. serialise list creation in this org, then 3. snapshot the source
    await lockQuotaScope(trx, `org_lists:${orgKey}`);
    const srcRes = await trx.raw(
      `SELECT id, organization_id, key, source_locale, status, revision, visibility
         FROM selection_lists WHERE id = ? FOR SHARE`,
      [sourceId],
    );
    const src = (srcRes as { rows?: SourceRow[] }).rows?.[0];
    if (!src) return { kind: 'source-gone' };
    if (sameOrg(src.organization_id, orgId)) return { kind: 'own-org' };
    if (src.visibility !== 'platform' || !sameOrg(src.organization_id, input.platformOrg)) return { kind: 'source-gone' };

    const countsRes = await trx.raw(
      `SELECT count(*)::int AS stored, (count(*) FILTER (WHERE status = 'active'))::int AS active
         FROM selection_list_items WHERE list_id = ?`,
      [sourceId],
    );
    const counts = (countsRes as { rows?: Array<{ stored: number; active: number }> }).rows?.[0] ?? { stored: 0, active: 0 };
    if (counts.stored > FORK_MAX_ITEMS) return { kind: 'too-large', items: counts.stored };

    const localesRes = await trx.raw(`SELECT count(*)::int AS n FROM selection_list_translations WHERE list_id = ?`, [sourceId]);
    const localeCount = (localesRes as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0;

    // 4b. quotas (exact: under the advisory lock)
    await checkListQuota(orgId, trx, userId);
    await checkForkQuota(orgId, { active: counts.active, stored: counts.stored, locales: localeCount }, trx);

    // key held by a DIFFERENT list of the organization (it cannot be a fork of this source: step 2)
    const keyRes = await trx.raw(`SELECT 1 FROM selection_lists WHERE organization_id = ANY(?) AND key = ?`, [orgRenderings, src.key]);
    if ((keyRes as { rows?: unknown[] }).rows?.length) return { kind: 'key-taken' };

    // 5. the copy
    await trx.raw(
      `INSERT INTO selection_lists
         (id, organization_id, key, source_locale, status, created_by, visibility,
          forked_from_list_id, forked_from_org_id, forked_from_revision, forked_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, now())`,
      [forkId, orgId, src.key, src.source_locale, userId, input.visibility, src.id, wireOrgId(src.organization_id), Number(src.revision)],
    );
    await trx.raw(
      `INSERT INTO selection_list_translations (list_id, locale, name, description, source_hash, is_machine)
       SELECT ?, locale, name, description, source_hash, is_machine
         FROM selection_list_translations WHERE list_id = ?`,
      [forkId, sourceId],
    );

    const srcItemsRes = await trx.raw(
      `SELECT id, code, sort_order, status FROM selection_list_items WHERE list_id = ? ORDER BY sort_order ASC, id ASC`,
      [sourceId],
    );
    const srcItems = (srcItemsRes as { rows?: Array<{ id: string; code: string; sort_order: number; status: string }> }).rows ?? [];
    const idMap = new Map<string, string>(); // source item id -> minted fork item id
    for (const it of srcItems) idMap.set(it.id, mintId('selectionListItem'));
    for (let i = 0; i < srcItems.length; i += ITEM_INSERT_CHUNK) {
      await trx('selection_list_items').insert(
        srcItems.slice(i, i + ITEM_INSERT_CHUNK).map((it) => ({
          id: idMap.get(it.id) as string,
          list_id: forkId,
          code: it.code,
          sort_order: it.sort_order,
          status: it.status,
          created_by: userId,
          origin_item_id: it.id,
        })),
      );
    }
    if (srcItems.length > 0) {
      const transRes = await trx.raw(
        `SELECT t.item_id, t.locale, t.label, t.description, t.source_hash, t.is_machine
           FROM selection_list_item_translations t
           JOIN selection_list_items i ON i.id = t.item_id
          WHERE i.list_id = ?`,
        [sourceId],
      );
      const trans = (transRes as { rows?: Array<{ item_id: string; locale: string; label: string; description: string | null; source_hash: string | null; is_machine: boolean }> }).rows ?? [];
      for (let i = 0; i < trans.length; i += ITEM_TRANSLATION_INSERT_CHUNK) {
        await trx('selection_list_item_translations').insert(
          trans.slice(i, i + ITEM_TRANSLATION_INSERT_CHUNK).map((t) => ({
            item_id: idMap.get(t.item_id) as string,
            locale: t.locale,
            label: t.label,
            description: t.description,
            source_hash: t.source_hash,
            is_machine: t.is_machine,
          })),
        );
      }
    }

    // 6. the caller owns the fork (machine identity, exactly as on create). The list row exists in this
    // transaction, which the mirror row's FK needs.
    input.onGrantAttempt();
    await grantListOwner(userId, orgId, forkId, userId, trx);

    // 7. events
    const eventCount = await emitForkEvents(trx, ctx, {
      listId: forkId,
      ownerUserId: wireUserId(userId),
      source: {
        listId: src.id,
        organizationId: wireOrgId(src.organization_id),
        listKey: src.key,
        listRevision: Number(src.revision),
      },
    });
    return { kind: 'created', eventCount, itemCount: srcItems.length };
  });
}
