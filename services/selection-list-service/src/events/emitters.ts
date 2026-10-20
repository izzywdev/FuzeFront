// events/emitters.ts — the domain-level event emitters the routes call.
//
// One function per published topic family. Every emitter:
//   1. runs INSIDE the caller's transaction (`trx`) — the route's data change
//      and the outbox row commit or roll back together;
//   2. reads the state it describes from `trx` (read-your-writes), so the
//      snapshot is exactly what the transaction is about to commit;
//   3. bumps `selection_lists.revision` once per emitted event that carries a
//      listRevision (access events carry none and do not bump), then
//   4. hands the payload to `enqueueEvent`, which validates it against the
//      topic's Zod schema and throws (rolling the transaction back) if the
//      route built something the frozen contract forbids.
//
// Call each emitter AFTER the data change it describes, as late in the handler
// as possible (after slow Security API calls) so the per-org outbox lock is held
// briefly. `emitListDeleted` is the one exception: it must run BEFORE the
// purge deletes the list row (it needs the row to read the key and bump the
// revision for the tombstone).
//
// Events are NOT written for: org-wide lifecycle cascades, list-purge cascades
// (list.deleted implies them), item-purge translation cascades, source-locale
// text (it surfaces as list.updated / item.updated), seeding (next stream).

import type { Request } from 'express';
import type { SelectionListActorV1 } from '@fuzefront/shared/kafka';
import { TOPICS } from '@fuzefront/shared/kafka';
import {
  bumpListRevision,
  enqueueEvent,
  enqueueEvents,
  EnqueueEventInput,
  EnqueuedEvent,
  OutboxExecutor,
  wireUserId,
} from './outbox';

/** Who caused the change, and which org/trace it belongs to. */
export interface EventContext {
  /** Stored organization id (TypeID or bare UUID); rendered to the wire form by the writer. */
  organizationId: string;
  actor: SelectionListActorV1;
  /** Envelope correlationId; defaults to the request id in `enqueueEvent`. */
  correlationId?: string;
}

/** Context for an authenticated end-user request (actor = the token's user). */
export function eventContextFromRequest(req: Pick<Request, 'orgId' | 'userId' | 'reqId'>): EventContext {
  return {
    organizationId: req.orgId as string,
    actor: { type: 'user', userId: wireUserId(req.userId as string) },
    correlationId: req.reqId,
  };
}

/** Context for the service acting on its own (seeding when `seedSource` is set, else a cascade). */
export function systemEventContext(
  organizationId: string,
  seedSource: string | null = null,
  correlationId?: string,
): EventContext {
  return {
    organizationId,
    actor: { type: 'system', principal: 'selection-list-service', seedSource },
    correlationId,
  };
}

// ---------------------------------------------------------------------------
// Snapshot readers (all read through the caller's trx)
// ---------------------------------------------------------------------------

export interface ListRow {
  id: string;
  key: string;
  source_locale: string;
  status: string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
  seed_source: string | null;
  seed_key: string | null;
  seed_version: number | null;
  seed_user_modified: boolean | null;
  /** 4.1.0 (migration 11): 'private' | 'org' | 'platform'. */
  visibility?: string | null;
  forked_from_list_id?: string | null;
  forked_from_org_id?: string | null;
  forked_from_revision?: string | number | null;
  forked_at?: Date | string | null;
  name: string | null;
  description: string | null;
}

export interface ItemRow {
  id: string;
  code: string;
  sort_order: string | number;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  seed_source: string | null;
  seed_key: string | null;
  seed_version: number | null;
  seed_user_modified: boolean | null;
  /** 4.1.0 (migration 11): the source item of a forked item. */
  origin_item_id?: string | null;
  label: string | null;
  description: string | null;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function seedOf(r: {
  seed_source: string | null;
  seed_key: string | null;
  seed_version: number | null;
  seed_user_modified: boolean | null;
}) {
  return r.seed_source === null || r.seed_source === undefined
    ? null
    : {
        source: r.seed_source,
        packKey: r.seed_key,
        packVersion: Number(r.seed_version),
        userModified: Boolean(r.seed_user_modified),
      };
}

export async function readList(trx: OutboxExecutor, listId: string): Promise<ListRow> {
  const res = await trx.raw(
    `SELECT sl.id, sl.key, sl.source_locale, sl.status, sl.revision, sl.created_at, sl.updated_at,
            sl.seed_source, sl.seed_key, sl.seed_version, sl.seed_user_modified,
            sl.visibility, sl.forked_from_list_id, sl.forked_from_org_id, sl.forked_from_revision, sl.forked_at,
            t.name, t.description
       FROM selection_lists sl
       LEFT JOIN LATERAL (
         SELECT x.name, x.description FROM selection_list_translations x
          WHERE x.list_id = sl.id
          ORDER BY (x.locale = sl.source_locale) DESC, (x.locale = 'en') DESC, x.locale
          LIMIT 1
       ) t ON true
      WHERE sl.id = ?`,
    [listId],
  );
  const row = (res as { rows?: ListRow[] }).rows?.[0];
  if (!row) throw new Error(`emit: list ${listId} not found in the transaction`);
  return row;
}

export async function readItem(trx: OutboxExecutor, itemId: string): Promise<ItemRow> {
  const res = await trx.raw(
    `SELECT i.id, i.code, i.sort_order, i.status, i.created_at, i.updated_at,
            i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
            t.label, t.description
       FROM selection_list_items i
       JOIN selection_lists sl ON sl.id = i.list_id
       LEFT JOIN LATERAL (
         SELECT x.label, x.description FROM selection_list_item_translations x
          WHERE x.item_id = i.id
          ORDER BY (x.locale = sl.source_locale) DESC, (x.locale = 'en') DESC, x.locale
          LIMIT 1
       ) t ON true
      WHERE i.id = ?`,
    [itemId],
  );
  const row = (res as { rows?: ItemRow[] }).rows?.[0];
  if (!row) throw new Error(`emit: item ${itemId} not found in the transaction`);
  return row;
}

/** `forkedFrom` of a list snapshot (HTTP `forked_from`): null for a list that is not a fork. */
function forkedFromOf(r: ListRow) {
  if (!r.forked_from_list_id) return null;
  return {
    listId: r.forked_from_list_id,
    organizationId: r.forked_from_org_id,
    listRevision: Number(r.forked_from_revision),
    forkedAt: iso(r.forked_at as Date | string),
  };
}

export function listSnapshot(r: ListRow) {
  return {
    listId: r.id,
    key: r.key,
    sourceLocale: r.source_locale,
    status: r.status,
    name: r.name,
    description: r.description ?? null,
    seed: seedOf(r),
    // Additive in shared 1.3.0: always emitted (the stored truth; a row older than migration 11 is private).
    visibility: r.visibility ?? 'private',
    forkedFrom: forkedFromOf(r),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function itemSnapshot(r: ItemRow) {
  return {
    itemId: r.id,
    code: r.code,
    label: r.label,
    description: r.description ?? null,
    sortOrder: Number(r.sort_order),
    status: r.status,
    seed: seedOf(r),
    originItemId: r.origin_item_id ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** The base every list-scoped payload carries (eventId/organizationId are set by the writer). */
export function listBase(ctx: EventContext, list: ListRow, listRevision: number) {
  return { actor: ctx.actor, listId: list.id, listKey: list.key, listRevision };
}

const send = (trx: OutboxExecutor, ctx: EventContext, topic: string, payload: Record<string, unknown>): Promise<EnqueuedEvent> =>
  enqueueEvent(trx, { topic, organizationId: ctx.organizationId, payload, correlationId: ctx.correlationId });

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * list.created — the row was just inserted in this transaction. Carries the
 * row's current revision (1 for a brand new list) WITHOUT bumping: the insert
 * itself is the first revision.
 */
export async function emitListCreated(trx: OutboxExecutor, ctx: EventContext, listId: string): Promise<EnqueuedEvent> {
  const list = await readList(trx, listId);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_LIST_CREATED, {
    ...listBase(ctx, list, Number(list.revision)),
    list: listSnapshot(list),
  });
}

/**
 * list.updated and/or list.archived for a list the caller JUST changed.
 *
 * `before` is the state read (via `readList`) inside the SAME transaction
 * BEFORE the change. The emitter diffs it against the current row, so
 * `changedFields` is exactly what changed and a request that changed nothing
 * emits nothing (and does not bump the revision):
 *   - key / sourceLocale / status(restore: archived -> active) / name /
 *     description changes -> list.updated (key change carries `previousKey`);
 *   - active -> archived -> list.archived (its own topic, never a `status`
 *     entry in `changedFields`), emitted after any list.updated for the same
 *     request. Each emitted event gets its own revision.
 * Returns the events written (0, 1 or 2).
 */
export async function emitListChanged(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  before: ListRow,
): Promise<EnqueuedEvent[]> {
  const after = await readList(trx, listId);
  const archivedNow = before.status !== 'archived' && after.status === 'archived';
  const changed: Array<'key' | 'sourceLocale' | 'status' | 'name' | 'description'> = [];
  if (before.key !== after.key) changed.push('key');
  if (before.source_locale !== after.source_locale) changed.push('sourceLocale');
  if (before.status !== after.status && !archivedNow) changed.push('status');
  if ((before.name ?? null) !== (after.name ?? null)) changed.push('name');
  if ((before.description ?? null) !== (after.description ?? null)) changed.push('description');

  const out: EnqueuedEvent[] = [];
  if (changed.length > 0) {
    const revision = await bumpListRevision(trx, ctx.organizationId, listId);
    out.push(
      await send(trx, ctx, TOPICS.SELECTION_LISTS_LIST_UPDATED, {
        ...listBase(ctx, after, revision),
        list: listSnapshot(after),
        changedFields: changed,
        previousKey: changed.includes('key') ? before.key : null,
      }),
    );
  }
  if (archivedNow) {
    const revision = await bumpListRevision(trx, ctx.organizationId, listId);
    out.push(
      await send(trx, ctx, TOPICS.SELECTION_LISTS_LIST_ARCHIVED, {
        ...listBase(ctx, after, revision),
        list: listSnapshot(after),
      }),
    );
  }
  return out;
}

/**
 * selection-lists.visibility.changed — the list's `visibility` JUST changed in this transaction
 * (`previous` = the value before). Its own topic and its own listRevision; emit it AFTER `emitListChanged`
 * for the same request so a combined PATCH yields list.updated (other fields) then this event.
 */
export async function emitVisibilityChanged(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  previous: string,
): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED, {
    ...listBase(ctx, list, revision),
    list: listSnapshot(list),
    previousVisibility: previous,
    visibility: list.visibility ?? 'private',
  });
}

/**
 * list.deleted (purge tombstone). Call BEFORE the purge deletes the list row:
 * it bumps the revision so the tombstone outranks every earlier event.
 */
export async function emitListDeleted(trx: OutboxExecutor, ctx: EventContext, listId: string): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_LIST_DELETED, listBase(ctx, list, revision));
}

/**
 * Every event of a FORK, in one go (design record D11), for a fork that was JUST written in this
 * transaction: list.created, item.created x n, translation.upserted x m (list-level then item-level, every
 * non-source locale), access.granted for the owner, then list.forked (provenance + the complete
 * source -> fork item id map). A fork-unaware consumer therefore builds a correct read model from the
 * ordinary events alone; list.forked adds what they cannot carry.
 *
 * A fork can be thousands of events, so this does NOT go through the one-event-at-a-time emitters (6+
 * statements each). It reads the fork's content once, assigns the per-list revisions in memory (the list
 * starts at 1; every event except access.granted takes the next one, exactly as `bumpListRevision` would),
 * validates and inserts the lot with `enqueueEvents`, and stores the final revision with ONE update.
 * Returns the number of events written.
 */
export async function emitForkEvents(
  trx: OutboxExecutor,
  ctx: EventContext,
  fork: {
    listId: string;
    ownerUserId: string;
    source: { listId: string; organizationId: string; listKey: string; listRevision: number };
  },
): Promise<number> {
  const list = await readList(trx, fork.listId);
  const itemsRes = await trx.raw(
    `SELECT i.id, i.code, i.sort_order, i.status, i.created_at, i.updated_at,
            i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
            t.label, t.description
       FROM selection_list_items i
       LEFT JOIN LATERAL (
         SELECT x.label, x.description FROM selection_list_item_translations x
          WHERE x.item_id = i.id
          ORDER BY (x.locale = ?) DESC, (x.locale = 'en') DESC, x.locale
          LIMIT 1
       ) t ON true
      WHERE i.list_id = ?
      ORDER BY i.sort_order ASC, i.id ASC`,
    [list.source_locale, fork.listId],
  );
  const items = ((itemsRes as { rows?: ItemRow[] }).rows ?? []) as ItemRow[];
  const listTransRes = await trx.raw(
    `SELECT locale, name, description, is_machine FROM selection_list_translations
      WHERE list_id = ? AND locale <> ? ORDER BY locale`,
    [fork.listId, list.source_locale],
  );
  const listTrans = ((listTransRes as { rows?: Array<{ locale: string; name: string; description: string | null; is_machine: boolean }> }).rows ?? []);
  const itemTransRes = await trx.raw(
    `SELECT t.item_id, i.code, t.locale, t.label, t.description, t.is_machine
       FROM selection_list_item_translations t
       JOIN selection_list_items i ON i.id = t.item_id
      WHERE i.list_id = ? AND t.locale <> ?
      ORDER BY i.sort_order ASC, i.id ASC, t.locale ASC`,
    [fork.listId, list.source_locale],
  );
  const itemTrans = ((itemTransRes as { rows?: Array<{ item_id: string; code: string; locale: string; label: string; description: string | null; is_machine: boolean }> }).rows ?? []);

  const inputs: EnqueueEventInput[] = [];
  const push = (topic: string, payload: Record<string, unknown>) =>
    inputs.push({ topic, organizationId: ctx.organizationId, payload, correlationId: ctx.correlationId });
  const snapshot = listSnapshot(list);
  let revision = Number(list.revision); // 1: the insert itself is the first revision

  push(TOPICS.SELECTION_LISTS_LIST_CREATED, { ...listBase(ctx, list, revision), list: snapshot });
  for (const item of items) {
    revision += 1;
    push(TOPICS.SELECTION_LISTS_ITEM_CREATED, { ...listBase(ctx, list, revision), item: itemSnapshot(item) });
  }
  for (const t of listTrans) {
    revision += 1;
    push(TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED, {
      ...listBase(ctx, list, revision),
      locale: t.locale,
      isMachine: Boolean(t.is_machine),
      target: { kind: 'list', name: t.name, description: t.description ?? null },
    });
  }
  for (const t of itemTrans) {
    revision += 1;
    push(TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED, {
      ...listBase(ctx, list, revision),
      locale: t.locale,
      isMachine: Boolean(t.is_machine),
      target: { kind: 'item', itemId: t.item_id, itemCode: t.code, label: t.label, description: t.description ?? null },
    });
  }
  push(TOPICS.SELECTION_LISTS_ACCESS_GRANTED, {
    actor: ctx.actor,
    listId: list.id,
    listKey: list.key,
    userId: fork.ownerUserId,
    role: 'list-owner',
    previousRole: null,
  });
  revision += 1;
  push(TOPICS.SELECTION_LISTS_LIST_FORKED, {
    ...listBase(ctx, list, revision),
    list: snapshot,
    source: {
      listId: fork.source.listId,
      organizationId: fork.source.organizationId,
      listKey: fork.source.listKey,
      listRevision: fork.source.listRevision,
    },
    itemMap: items.map((i) => ({ originItemId: i.origin_item_id, itemId: i.id })),
  });

  await enqueueEvents(trx, inputs);
  // The revision counter was assigned in memory above; store where it ended (the DB only enforces >= and never decreasing).
  await trx.raw('UPDATE selection_lists SET revision = ? WHERE id = ?', [revision, fork.listId]);
  return inputs.length;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const emitItemCreated = async (
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  itemId: string,
): Promise<EnqueuedEvent> => {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  const item = await readItem(trx, itemId);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_ITEM_CREATED, {
    ...listBase(ctx, list, revision),
    item: itemSnapshot(item),
  });
};

/**
 * item.updated and/or item.archived for an item the caller JUST changed; same
 * contract as `emitListChanged` (`before` = `readItem` in this transaction,
 * before the change; no change -> no event, no revision bump). `changedFields`
 * are label | description | sortOrder | status (restore only).
 */
export async function emitItemChanged(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  itemId: string,
  before: ItemRow,
): Promise<EnqueuedEvent[]> {
  const after = await readItem(trx, itemId);
  const archivedNow = before.status !== 'archived' && after.status === 'archived';
  const changed: Array<'label' | 'description' | 'sortOrder' | 'status'> = [];
  if ((before.label ?? null) !== (after.label ?? null)) changed.push('label');
  if ((before.description ?? null) !== (after.description ?? null)) changed.push('description');
  if (Number(before.sort_order) !== Number(after.sort_order)) changed.push('sortOrder');
  if (before.status !== after.status && !archivedNow) changed.push('status');

  const out: EnqueuedEvent[] = [];
  const list = await readList(trx, listId);
  if (changed.length > 0) {
    const revision = await bumpListRevision(trx, ctx.organizationId, listId);
    out.push(
      await send(trx, ctx, TOPICS.SELECTION_LISTS_ITEM_UPDATED, {
        ...listBase(ctx, list, revision),
        item: itemSnapshot(after),
        changedFields: changed,
      }),
    );
  }
  if (archivedNow) {
    const revision = await bumpListRevision(trx, ctx.organizationId, listId);
    out.push(
      await send(trx, ctx, TOPICS.SELECTION_LISTS_ITEM_ARCHIVED, {
        ...listBase(ctx, list, revision),
        item: itemSnapshot(after),
      }),
    );
  }
  return out;
}

/** item.deleted (purge). The item row may already be gone; only the list row is read. */
export async function emitItemDeleted(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  item: { itemId: string; code: string },
): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_ITEM_DELETED, {
    ...listBase(ctx, list, revision),
    itemId: item.itemId,
    code: item.code,
  });
}

/** item.reordered — the full resulting order of the list's ACTIVE items, after the new sort_orders are written. */
export async function emitItemReordered(trx: OutboxExecutor, ctx: EventContext, listId: string): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  const res = await trx.raw(
    `SELECT id, code, sort_order FROM selection_list_items
      WHERE list_id = ? AND status = 'active' ORDER BY sort_order ASC, id ASC`,
    [listId],
  );
  const rows = (res as { rows?: Array<{ id: string; code: string; sort_order: string | number }> }).rows ?? [];
  return send(trx, ctx, TOPICS.SELECTION_LISTS_ITEM_REORDERED, {
    ...listBase(ctx, list, revision),
    order: rows.map((r) => ({ itemId: r.id, code: r.code, sortOrder: Number(r.sort_order) })),
  });
}

// ---------------------------------------------------------------------------
// Translations (non-source locales only)
// ---------------------------------------------------------------------------

/** translation.upserted for a list-level translation, read back from `trx` after the upsert. */
export async function emitListTranslationUpserted(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  locale: string,
): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  const res = await trx.raw(
    `SELECT name, description, is_machine FROM selection_list_translations WHERE list_id = ? AND locale = ?`,
    [listId, locale],
  );
  const t = (res as { rows?: Array<{ name: string; description: string | null; is_machine: boolean }> }).rows?.[0];
  if (!t) throw new Error(`emit: translation ${listId}/${locale} not found in the transaction`);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED, {
    ...listBase(ctx, list, revision),
    locale,
    isMachine: Boolean(t.is_machine),
    target: { kind: 'list', name: t.name, description: t.description ?? null },
  });
}

/** translation.upserted for an item-level translation, read back from `trx` after the upsert. */
export async function emitItemTranslationUpserted(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  itemId: string,
  locale: string,
): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  const res = await trx.raw(
    `SELECT i.code, t.label, t.description, t.is_machine
       FROM selection_list_item_translations t
       JOIN selection_list_items i ON i.id = t.item_id
      WHERE t.item_id = ? AND t.locale = ?`,
    [itemId, locale],
  );
  const t = (res as { rows?: Array<{ code: string; label: string; description: string | null; is_machine: boolean }> }).rows?.[0];
  if (!t) throw new Error(`emit: translation ${itemId}/${locale} not found in the transaction`);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED, {
    ...listBase(ctx, list, revision),
    locale,
    isMachine: Boolean(t.is_machine),
    target: { kind: 'item', itemId, itemCode: t.code, label: t.label, description: t.description ?? null },
  });
}

/** translation.deleted — `item` is set for an item-level translation (call after the delete; no read of the gone row). */
export async function emitTranslationDeleted(
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  locale: string,
  item?: { itemId: string; itemCode: string },
): Promise<EnqueuedEvent> {
  const revision = await bumpListRevision(trx, ctx.organizationId, listId);
  const list = await readList(trx, listId);
  return send(trx, ctx, TOPICS.SELECTION_LISTS_TRANSLATION_DELETED, {
    ...listBase(ctx, list, revision),
    locale,
    target: item ? { kind: 'item', itemId: item.itemId, itemCode: item.itemCode } : { kind: 'list' },
  });
}

// ---------------------------------------------------------------------------
// Access (no listRevision: access does not change list content)
// ---------------------------------------------------------------------------

async function accessEvent(
  trx: OutboxExecutor,
  ctx: EventContext,
  topic: string,
  listId: string,
  fields: Record<string, unknown>,
): Promise<EnqueuedEvent> {
  const list = await readList(trx, listId);
  return send(trx, ctx, topic, { actor: ctx.actor, listId: list.id, listKey: list.key, ...fields });
}

export const emitAccessGranted = (
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  grant: { userId: string; role: string; previousRole: string | null },
) =>
  accessEvent(trx, ctx, TOPICS.SELECTION_LISTS_ACCESS_GRANTED, listId, {
    userId: grant.userId,
    role: grant.role,
    previousRole: grant.previousRole,
  });

export const emitAccessRevoked = (
  trx: OutboxExecutor,
  ctx: EventContext,
  listId: string,
  revoked: { userId: string; role: string },
) =>
  accessEvent(trx, ctx, TOPICS.SELECTION_LISTS_ACCESS_REVOKED, listId, {
    userId: revoked.userId,
    role: revoked.role,
  });
