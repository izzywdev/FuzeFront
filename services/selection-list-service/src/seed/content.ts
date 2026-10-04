// seed/content.ts - the "seeded-then-edited" hash (plan section 9.1).
//
// Each seeded list/item row stores `seed_hash`: the SHA-256 of exactly the content
// seeding wrote. To decide whether a human has touched a row we RECOMPUTE the hash of
// the row's current values and compare. Hash comparison (not "did an HTTP route set a
// flag") is the authority, so a code path that forgets to set `seed_user_modified`
// still cannot cause an overwrite; the persisted flag only makes the answer cheap to
// emit in event snapshots.
//
// What is hashed (and so what counts as an edit):
//   list: key, source locale, status, source-locale name + description, and the
//         NON-MACHINE translations of every other locale.
//   item: label + description (source locale), status, and the non-machine
//         translations of every other locale.
// Deviations from the plan's field list, both deliberate and conservative (they can
// only make seeding leave a row ALONE more often, never overwrite more):
//   - a list's `status` is part of its hash, so a human who archives (or restores) a
//     seeded list has taken ownership of it. The plan hashes status for items only.
//   - when SEEDING itself archives or restores a row it rewrites `seed_hash`, so the
//     row stays "unmodified" after seeding's own change.
// Machine translations (is_machine = true, written by autofill) are ignored: they are
// tracked by `is_machine` and an autofill run is not an edit of the item (plan 9.1).
// A human-written translation for a locale the seed did not write IS an edit.
// `sort_order` is not hashed: seeding never reorders and a user reorder is not a
// content edit.

import type { SelectionListSeedItemSpecV1, SelectionListSeedListSpecV1 } from '@fuzefront/shared/kafka';
import type { Knex } from 'knex';
import { hashCanonical } from './canonical';

type Executor = Knex | Knex.Transaction;

export interface TranslationContent {
  locale: string;
  text: string;
  description: string | null;
}

export interface ListContent {
  key: string;
  sourceLocale: string;
  status: 'active' | 'archived';
  name: string;
  description: string | null;
  /** Non-source locales only, sorted by locale. */
  translations: TranslationContent[];
}

export interface ItemContent {
  label: string;
  description: string | null;
  status: 'active' | 'archived';
  /** Non-source locales only, sorted by locale. */
  translations: TranslationContent[];
}

const byLocale = (a: TranslationContent, b: TranslationContent): number => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0);

export function listContentFromSpec(spec: SelectionListSeedListSpecV1, status: 'active' | 'archived' = 'active'): ListContent {
  return {
    key: spec.key,
    sourceLocale: spec.sourceLocale,
    status,
    name: spec.name,
    description: spec.description ?? null,
    translations: (spec.translations ?? [])
      .map((t) => ({ locale: t.locale, text: t.name, description: t.description ?? null }))
      .sort(byLocale),
  };
}

export function itemContentFromSpec(spec: SelectionListSeedItemSpecV1, status: 'active' | 'archived' = 'active'): ItemContent {
  return {
    label: spec.label,
    description: spec.description ?? null,
    status,
    translations: (spec.translations ?? [])
      .map((t) => ({ locale: t.locale, text: t.label, description: t.description ?? null }))
      .sort(byLocale),
  };
}

export const hashListContent = (c: ListContent): string => hashCanonical({ kind: 'list', ...c });
export const hashItemContent = (c: ItemContent): string => hashCanonical({ kind: 'item', ...c });

// ---------------------------------------------------------------------------
// Current content, read from the database (batch: two queries per kind)
// ---------------------------------------------------------------------------

interface TranslationRow {
  locale: string;
  is_machine: boolean;
  text: string;
  description: string | null;
}

function split(rows: TranslationRow[], sourceLocale: string): { source: TranslationRow | undefined; others: TranslationContent[] } {
  return {
    source: rows.find((r) => r.locale === sourceLocale),
    others: rows
      .filter((r) => r.locale !== sourceLocale && !r.is_machine)
      .map((r) => ({ locale: r.locale, text: r.text, description: r.description ?? null }))
      .sort(byLocale),
  };
}

/** Current content of the given lists (absent ids are absent from the map). */
export async function readListContents(ex: Executor, listIds: string[]): Promise<Map<string, ListContent>> {
  const out = new Map<string, ListContent>();
  if (listIds.length === 0) return out;
  const lists = await ex('selection_lists').whereIn('id', listIds).select('id', 'key', 'source_locale', 'status');
  const trs = await ex('selection_list_translations')
    .whereIn('list_id', listIds)
    .select('list_id', 'locale', 'is_machine', 'name as text', 'description');
  const byList = new Map<string, TranslationRow[]>();
  for (const t of trs) {
    const arr = byList.get(t.list_id) ?? [];
    arr.push(t);
    byList.set(t.list_id, arr);
  }
  for (const l of lists) {
    const { source, others } = split(byList.get(l.id) ?? [], l.source_locale);
    out.set(l.id, {
      key: l.key,
      sourceLocale: l.source_locale,
      status: l.status,
      name: source?.text ?? '',
      description: source?.description ?? null,
      translations: others,
    });
  }
  return out;
}

/** Current content of the given items (absent ids are absent from the map). */
export async function readItemContents(ex: Executor, itemIds: string[]): Promise<Map<string, ItemContent>> {
  const out = new Map<string, ItemContent>();
  if (itemIds.length === 0) return out;
  const items = await ex('selection_list_items as i')
    .join('selection_lists as sl', 'sl.id', 'i.list_id')
    .whereIn('i.id', itemIds)
    .select('i.id', 'i.status', 'sl.source_locale');
  const trs = await ex('selection_list_item_translations')
    .whereIn('item_id', itemIds)
    .select('item_id', 'locale', 'is_machine', 'label as text', 'description');
  const byItem = new Map<string, TranslationRow[]>();
  for (const t of trs) {
    const arr = byItem.get(t.item_id) ?? [];
    arr.push(t);
    byItem.set(t.item_id, arr);
  }
  for (const i of items) {
    const { source, others } = split(byItem.get(i.id) ?? [], i.source_locale);
    out.set(i.id, {
      label: source?.text ?? '',
      description: source?.description ?? null,
      status: i.status,
      translations: others,
    });
  }
  return out;
}

/** True when the content currently in the database differs from what seeding wrote (`seed_hash`). */
export const listDiffersFromSeed = (current: ListContent | undefined, seedHash: string): boolean =>
  !current || hashListContent(current) !== seedHash;
export const itemDiffersFromSeed = (current: ItemContent | undefined, seedHash: string): boolean =>
  !current || hashItemContent(current) !== seedHash;

// ---------------------------------------------------------------------------
// Human edits: persist `seed_user_modified` (used by the HTTP update paths)
// ---------------------------------------------------------------------------

/**
 * After a HUMAN changed a list (PATCH / archive / translation PUT|DELETE), set
 * `seed_user_modified = true` if the row is seeded and its content no longer hashes
 * to `seed_hash`. A request that changed nothing leaves the flag alone; a row that is
 * not seeded (or already flagged) costs one indexed read. Never touches `updated_at`
 * or `revision` (the caller's emitter owns those). Call it BEFORE the emitter, so the
 * snapshot in the same transaction already carries `seed.userModified: true`.
 * Returns whether the flag was newly set.
 */
export async function refreshListUserModified(trx: Executor, listId: string): Promise<boolean> {
  const row = await trx('selection_lists').where({ id: listId }).first('seed_source', 'seed_hash', 'seed_user_modified');
  if (!row || row.seed_source === null || row.seed_user_modified) return false;
  const current = (await readListContents(trx, [listId])).get(listId);
  if (!listDiffersFromSeed(current, row.seed_hash)) return false;
  await trx('selection_lists').where({ id: listId }).update({ seed_user_modified: true });
  return true;
}

/** Item counterpart of `refreshListUserModified`. */
export async function refreshItemUserModified(trx: Executor, itemId: string): Promise<boolean> {
  const row = await trx('selection_list_items').where({ id: itemId }).first('seed_source', 'seed_hash', 'seed_user_modified');
  if (!row || row.seed_source === null || row.seed_user_modified) return false;
  const current = (await readItemContents(trx, [itemId])).get(itemId);
  if (!itemDiffersFromSeed(current, row.seed_hash)) return false;
  await trx('selection_list_items').where({ id: itemId }).update({ seed_user_modified: true });
  return true;
}
