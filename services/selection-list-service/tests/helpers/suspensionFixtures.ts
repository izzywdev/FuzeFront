// Shared fixtures for the platform-suspension suites (shared-lists.suspension-race / suspension-owner): a fresh
// common list with everything a mutation could touch, and the full set of mutation paths a suspended owner must
// refuse. Test code only.

import type { Knex } from 'knex';
import { P, PLATFORM, Principal, World } from './sharedWorld';

export interface Ctx {
  L: string;
  id: string;
  item: string;
  second: string;
}

export type Attempt = [string, (c: Ctx) => PromiseLike<{ status: number; body: any }>];

/**
 * A fresh common (platform-visibility) list owned by the platform org: two items, an `fr` translation of the list
 * and of item one, a viewer grant for opEditor. Must run with the shared-lists flag ON and the platform org
 * configured and not suspended. Kept out of the per-user list quota (the suites make dozens of lists as one operator).
 */
export async function freshCommonList(w: World, key: string, op: Principal = P.op): Promise<Ctx> {
  const made = await w.api(op).post('/v1/selection-lists', { key, name: 'Fixture', visibility: 'platform' });
  if (made.status !== 201) throw new Error(`fixture list failed: ${made.status} ${JSON.stringify(made.body)}`);
  const id: string = made.body.id;
  await w.db('selection_lists').where({ id }).update({ created_by: 'system' });
  const L = `/v1/selection-lists/${id}`;
  const item = await w.api(op).post(`${L}/items`, { code: 'A', label: 'A' });
  const second = await w.api(op).post(`${L}/items`, { code: 'B', label: 'B' });
  if (item.status !== 201 || second.status !== 201) throw new Error('fixture items failed');
  await w.api(op).put(`${L}/translations/fr`, { name: 'Fixture fr' });
  await w.api(op).put(`${L}/items/${item.body.id}/translations/fr`, { label: 'A fr' });
  w.authz.give(PLATFORM, P.opEditor.userId, id, 'list-viewer');
  return { L, id, item: item.body.id, second: second.body.id };
}

/** The names of `mutationAttempts`, available at describe time (the world exists only after `beforeAll`). */
export const ATTEMPT_NAMES: string[] = [];

/** Every mutation path of a list's content, translations and access (run by `op`). */
export function mutationAttempts(w: World, op: Principal = P.op): Attempt[] {
  return [
    ['PATCH list', (c) => w.api(op).patch(c.L, { description: 'x' })],
    ['PATCH list status=archived (archive)', (c) => w.api(op).patch(c.L, { status: 'archived' })],
    ['PATCH list status=active (restore)', (c) => w.api(op).patch(c.L, { status: 'active' })],
    ['DELETE list (archive)', (c) => w.api(op).del(c.L)],
    ['POST list/archive', (c) => w.api(op).post(`${c.L}/archive`)],
    ['DELETE list ?purge=true', (c) => w.api(op).del(`${c.L}?purge=true`)],
    ['POST item', (c) => w.api(op).post(`${c.L}/items`, { code: 'Z', label: 'Z' })],
    ['PATCH item', (c) => w.api(op).patch(`${c.L}/items/${c.item}`, { label: 'Z' })],
    ['PUT items/reorder', (c) => w.api(op).put(`${c.L}/items/reorder`, { item_ids: [c.second, c.item] })],
    ['DELETE item (archive)', (c) => w.api(op).del(`${c.L}/items/${c.item}`)],
    ['POST item/archive', (c) => w.api(op).post(`${c.L}/items/${c.item}/archive`)],
    ['DELETE item ?purge=true', (c) => w.api(op).del(`${c.L}/items/${c.item}?purge=true`)],
    ['PUT list translation', (c) => w.api(op).put(`${c.L}/translations/de`, { name: 'Nope' })],
    ['DELETE list translation', (c) => w.api(op).del(`${c.L}/translations/fr`)],
    ['POST list translation autofill', (c) => w.api(op).post(`${c.L}/translations/de/autofill`, {})],
    ['PUT item translation', (c) => w.api(op).put(`${c.L}/items/${c.item}/translations/de`, { label: 'Nope' })],
    ['DELETE item translation', (c) => w.api(op).del(`${c.L}/items/${c.item}/translations/fr`)],
    ['PUT access', (c) => w.api(op).put(`${c.L}/access/${P.opEditor.userId}`, { role: 'list-editor' })],
    ['DELETE access', (c) => w.api(op).del(`${c.L}/access/${P.opEditor.userId}`)],
  ];
}

ATTEMPT_NAMES.push(...mutationAttempts(null as never).map((a) => a[0]));

/** Everything a mutation could change, for "nothing was written". */
export async function fingerprint(db: Knex, listId: string): Promise<string> {
  return JSON.stringify({
    list: await db('selection_lists').where({ id: listId }).first(),
    items: await db('selection_list_items').where({ list_id: listId }).orderBy('id'),
    listTr: await db('selection_list_translations').where({ list_id: listId }).orderBy('locale'),
    itemTr: await db('selection_list_item_translations').whereIn('item_id', db('selection_list_items').select('id').where({ list_id: listId })).orderBy(['item_id', 'locale']),
    access: await db('selection_list_access').where({ list_id: listId }).orderBy('user_id'),
    outbox: Number(((await db('event_outbox').count('seq as c').first()) as { c: string }).c),
  });
}
