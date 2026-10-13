/**
 * Fork size cap (SL9, D6 "Size"): a source with MORE than 5000 non-purged items is refused with
 * `400 VALIDATION_ERROR` (the bound of the `list.forked` event's item map); exactly 5000 is allowed.
 * Written against the FROZEN contract (openapi.yaml 4.1.0, `forkSelectionList`: "A source with more than 5000
 * non-purged items is refused with 400 VALIDATION_ERROR") and the event schema
 * (`SELECTION_LIST_MAX_FORK_ITEMS`, `selectionListsListForkedSchemaV1`: `itemMap.max(5000)`).
 * Needs the shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Design-record rows pinned (§11.5 fork + D6 "Size"):
 *   - 5001 non-purged items -> 400 VALIDATION_ERROR, nothing created, no event;
 *   - 5000 non-purged items -> 201, every item copied, and the `list.forked` event carries an `itemMap` of exactly 5000
 *     that validates against the frozen schema.
 *
 * Fixture technique: item quotas make 5000 API creates impractical, so the bulk rows are inserted directly into
 * `selection_list_items` / `selection_list_item_translations` (4.0.0 tables — not the new columns) under a platform
 * list that was itself published through the API. The forking org has a per-list ceiling of 10000
 * (helpers/global-setup.ts) so the QUOTA path can never mask the cap: only the 5000 rule can refuse.
 */
import { actor, call, createPlatformList, expectError, forkList, L, rnd, assertSharedListsOn, walkLists } from '../helpers/shared-lists';
import { FORK_BIG_ORG_ID } from '../helpers/sl9-constants';
import { closeDb, dbQuery } from '../helpers/db';
import { payloadErrors, TOPICS } from '../helpers/outbox';

const forker = actor('big', FORK_BIG_ORG_ID, 'admin');

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await dropOutbox();
  await closeDb();
});

/**
 * A 5000-item fork enqueues ~5000 outbox rows in this (dedicated) org. contract/outbox-relay.test.ts runs real relay
 * passes over EVERY org's pending rows in a parallel worker; leaving thousands of freshly written rows (and a
 * 5000-entry `list.forked`) for it to chew on makes its timing-sensitive assertions flaky (observed: O2/O3 failed in
 * 2 of 6 full runs, 0 of 8 without this file). The events were already asserted, so drop this org's rows right after.
 */
const dropOutbox = (): Promise<unknown> => dbQuery('DELETE FROM event_outbox WHERE organization_id = $1', [FORK_BIG_ORG_ID]);

async function bulkItems(listId: string, count: number, tag: string): Promise<void> {
  await dbQuery(
    `INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by, created_at, updated_at)
     SELECT 'front_sli_bk' || $3::text || lpad(g::text, 8, '0'), $1, 'B' || g, g, 'active', 'system:selection-list-service', now(), now()
       FROM generate_series(1, $2::int) g`,
    [listId, count, tag],
  );
  await dbQuery(
    `INSERT INTO selection_list_item_translations (item_id, locale, label, is_machine, updated_at)
     SELECT id, 'en', 'Bulk ' || code, false, now() FROM selection_list_items WHERE list_id = $1 AND code LIKE 'B%'`,
    [listId],
  );
}

describe('D6 size: more than 5000 non-purged items is refused', () => {
  it('5001 non-purged items -> 400 VALIDATION_ERROR, nothing created in the forking org, no list.forked event', async () => {
    const tag = rnd();
    const p = await createPlatformList({ itemCodes: [] });
    await bulkItems(p.list.id, 5001, tag);
    const eventCount = async (): Promise<number> =>
      Number((await dbQuery<{ n: string }>('SELECT count(*)::text AS n FROM event_outbox WHERE organization_id = $1', [FORK_BIG_ORG_ID]))[0].n);
    try {
      const before = await eventCount();
      const res = await forkList(forker, p.list.id);
      expectError(res, 400, 'VALIDATION_ERROR');
      expect((await walkLists(forker, 'status=all')).rows).toEqual([]);
      expect(await eventCount()).toBe(before);
      // control: purging one item brings the source to exactly 5000 and the SAME call is now accepted (see the next test for its shape)
      expect((await call(p.owner, 'DELETE', `${L(p.list.id)}/items/front_sli_bk${tag}00000001?purge=true`)).status).toBe(204);
      const ok = await forkList(forker, p.list.id);
      expect(ok.status).toBe(201);
    } finally {
      await dropOutbox();
    }
  }, 180_000);

  it('exactly 5000 non-purged items -> 201; every item copied; list.forked.itemMap has 5000 entries and validates', async () => {
    const tag = rnd();
    const p = await createPlatformList({ itemCodes: [] });
    await bulkItems(p.list.id, 5000, tag);
    const org = actor('big5k', FORK_BIG_ORG_ID, 'admin');
    try {
      const res = await forkList(org, p.list.id);
      expect(res.status).toBe(201);
      const copied = await dbQuery<{ n: string; withOrigin: string }>(
        'SELECT count(*)::text AS n, count(origin_item_id)::text AS "withOrigin" FROM selection_list_items WHERE list_id = $1',
        [res.body.id],
      );
      expect(Number(copied[0].n)).toBe(5000);
      expect(Number(copied[0].withOrigin)).toBe(5000);
      const forked = await dbQuery<{ topic: string; payload: Record<string, any> }>(
        `SELECT topic, payload FROM event_outbox WHERE organization_id = $1 AND topic = $2 AND payload->>'listId' = $3`,
        [FORK_BIG_ORG_ID, TOPICS.SELECTION_LISTS_LIST_FORKED, res.body.id],
      );
      expect(forked).toHaveLength(1);
      expect(payloadErrors(forked[0].topic, forked[0].payload)).toEqual([]);
      expect(forked[0].payload['itemMap']).toHaveLength(5000);
    } finally {
      await dropOutbox();
    }
  }, 180_000);
});
