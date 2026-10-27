// list-revision.db.test.ts — `SelectionList.revision` (openapi 4.2.0; design record section 13) through the real
// app and REAL Postgres.
//
// Pins (docs/planning/selection-lists-shared-and-fork.md §13.3 R1-R5, §13.4 items 1, 2, 5-8):
//   - EVERY SelectionList response carries an integer `revision >= 1`, with the shared-lists flag ON and OFF (R4);
//   - event parity: after each mutation the list's `revision` equals the highest `listRevision` among that list's
//     outbox rows, and a mutation's own response carries it (a PATCH that bumps twice reports the second);
//   - an access-grant change leaves it unchanged;
//   - a fork's `forked_from.revision` is the source's revision at copy time; one change to the source moves the
//     source's revision past it ("behind"), no change leaves them equal ("up-to-date").

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { createWorld, ORG_A, P, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';
import { assertConforms } from './helpers/openapi';
import { setFlagClient } from '../src/flags';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('SelectionList.revision (real Postgres)', () => {
  let w: World;

  beforeAll(async () => {
    w = await createWorld(state);
    w.authz.member(ORG_A, P.aMember.userId); // the membership probe of the access PUT
  });
  afterAll(() => w.teardown());

  /** The highest `listRevision` the service has committed for `listId` (outbox rows with no revision are access events). */
  async function eventRevision(listId: string): Promise<number> {
    const r = await w.db.raw(
      `SELECT max((payload->>'listRevision')::bigint) AS rev FROM event_outbox WHERE payload->>'listId' = ? AND payload->>'listRevision' IS NOT NULL`,
      [listId],
    );
    return Number(r.rows[0].rev);
  }

  /** GET the list and assert its revision is an integer >= 1 equal to the latest event's listRevision. */
  async function expectParity(p: typeof P.aAdmin, listId: string, own?: { body?: { revision?: unknown } }): Promise<number> {
    const got = await w.api(p).get(`/v1/selection-lists/${listId}`);
    expect(got.status).toBe(200);
    assertConforms('SelectionList', got.body);
    expect(Number.isInteger(got.body.revision)).toBe(true);
    expect(got.body.revision).toBeGreaterThanOrEqual(1);
    expect(got.body.revision).toBe(await eventRevision(listId));
    // the mutation's own SelectionList response is at least as new as its last event (here: exactly the latest)
    if (own?.body && 'revision' in own.body) expect(own.body.revision).toBe(got.body.revision);
    return got.body.revision as number;
  }

  for (const shared of [false, true]) {
    describe(`shared-lists flag ${shared ? 'ON' : 'OFF'}`, () => {
      beforeAll(() => setFlagClient(flagClientWith(shared)));
      afterAll(() => setFlagClient(flagClientWith(true)));

      it('emits revision on create/get/list and tracks the event counter through every kind of change', async () => {
        const a = w.api(P.aAdmin);
        const key = shared ? 'rev-on' : 'rev-off';

        let res = await a.post('/v1/selection-lists', { key, name: 'Revisions' });
        expect(res.status).toBe(201);
        assertConforms('SelectionList', res.body);
        expect(res.body.revision).toBe(1); // 1 at creation
        const listId: string = res.body.id;
        expect(await expectParity(P.aAdmin, listId, res)).toBe(1);

        // the collection carries it too
        const page = await a.get('/v1/selection-lists?status=all&limit=200');
        expect(page.status).toBe(200);
        const row = page.body.items.find((l: any) => l.id === listId);
        expect(row.revision).toBe(1);

        let last = 1;
        const step = async (label: string, run: () => Promise<any>, bumps: number) => {
          const out = await run();
          if (![200, 201, 204].includes(out.status)) throw new Error(`${label}: ${out.status} ${JSON.stringify(out.body)}`);
          const rev = await expectParity(P.aAdmin, listId, out);
          expect({ label, rev }).toEqual({ label, rev: last + bumps }); // strictly increasing by one per event
          last = rev;
        };

        await step('patch name', () => a.patch(`/v1/selection-lists/${listId}`, { name: 'Revisions 2' }), 1);
        await step('patch no-op', () => a.patch(`/v1/selection-lists/${listId}`, { name: 'Revisions 2' }), 0);
        let item = await a.post(`/v1/selection-lists/${listId}/items`, { code: 'A', label: 'A' });
        last = await expectParity(P.aAdmin, listId);
        expect(last).toBe(3); // item.created
        const itemA: string = item.body.id;
        item = await a.post(`/v1/selection-lists/${listId}/items`, { code: 'B', label: 'B' });
        const itemB: string = item.body.id;
        last = await expectParity(P.aAdmin, listId);
        await step('item update', () => a.patch(`/v1/selection-lists/${listId}/items/${itemA}`, { label: 'AA' }), 1);
        await step('reorder', () => a.put(`/v1/selection-lists/${listId}/items/reorder`, { item_ids: [itemB, itemA] }), 1);
        await step('item archive', () => a.post(`/v1/selection-lists/${listId}/items/${itemA}/archive`), 1);
        await step('list translation upsert', () => a.put(`/v1/selection-lists/${listId}/translations/fr`, { name: 'Revisions fr' }), 1);
        await step('item translation upsert', () => a.put(`/v1/selection-lists/${listId}/items/${itemB}/translations/fr`, { label: 'B fr' }), 1);
        await step('autofill', () => a.post(`/v1/selection-lists/${listId}/translations/de/autofill`, {}), 2);
        await step('item translation delete', () => a.del(`/v1/selection-lists/${listId}/items/${itemB}/translations/fr`), 1);
        await step('list translation delete', () => a.del(`/v1/selection-lists/${listId}/translations/fr`), 1);
        await step('item purge', () => a.del(`/v1/selection-lists/${listId}/items/${itemA}?purge=true`), 1);

        // an access grant is NOT a revisioned change
        await step('access grant', () => a.put(`/v1/selection-lists/${listId}/access/${P.aMember.userId}`, { role: 'list-viewer' }), 0);
        await step('access revoke', () => a.del(`/v1/selection-lists/${listId}/access/${P.aMember.userId}`), 0);

        await step('archive', () => a.post(`/v1/selection-lists/${listId}/archive`), 1);
        await step('restore', () => a.patch(`/v1/selection-lists/${listId}`, { status: 'active' }), 1);
        await step('soft delete', () => a.del(`/v1/selection-lists/${listId}`), 1);
      });
    });
  }

  it('a PATCH that changes fields AND visibility bumps twice and the response reports the second', async () => {
    setFlagClient(flagClientWith(true));
    const a = w.api(P.aAdmin);
    const created = await a.post('/v1/selection-lists', { key: 'rev-vis', name: 'Vis' });
    const listId: string = created.body.id;
    const res = await a.patch(`/v1/selection-lists/${listId}`, { name: 'Vis 2', visibility: 'org' });
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(3);
    expect(await eventRevision(listId)).toBe(3);
  });

  describe('fork provenance (shared-lists ON)', () => {
    beforeAll(() => setFlagClient(flagClientWith(true)));

    it('forked_from.revision = the source revision at copy time; the source moves past it only after a change', async () => {
      const src = await publishPriorityList(w);
      const op = w.api(P.op);
      const before = (await op.get(`/v1/selection-lists/${src.listId}`)).body.revision as number;
      expect(before).toBe(await eventRevision(src.listId));

      const fork = await w.api(P.aMember).post(`/v1/selection-lists/${src.listId}/fork`, {});
      expect(fork.status).toBe(201);
      assertConforms('SelectionList', fork.body);
      expect(fork.body.forked_from.revision).toBe(before);
      // the fork's own revision is its own event counter (created + items + translations + forked), not the source's
      expect(fork.body.revision).toBe(await eventRevision(fork.body.id));
      expect(fork.body.revision).toBeGreaterThan(1);

      // no change to the source: up to date
      const same = (await op.get(`/v1/selection-lists/${src.listId}`)).body.revision;
      expect(same).toBe(fork.body.forked_from.revision);

      // one change to the source: it is ahead, the fork's record never moves
      expect((await op.patch(`/v1/selection-lists/${src.listId}`, { name: 'Priority!' })).status).toBe(200);
      const after = (await op.get(`/v1/selection-lists/${src.listId}`)).body.revision;
      expect(after).toBeGreaterThan(fork.body.forked_from.revision);
      const reread = await w.api(P.aMember).get(`/v1/selection-lists/${fork.body.id}`);
      expect(reread.body.forked_from.revision).toBe(before);

      // the idempotent repeat (200) reports the same provenance and a revision
      const again = await w.api(P.aMember).post(`/v1/selection-lists/${src.listId}/fork`, {});
      expect(again.status).toBe(200);
      expect(again.body.forked_from.revision).toBe(before);
      expect(again.body.revision).toBe(await eventRevision(fork.body.id));
    });
  });
});
