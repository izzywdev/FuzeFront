// items.status-all.db.test.ts — GET /v1/selection-lists/{listId}/items?status=all (openapi 4.2.0 documents
// `enum: [active, archived, all]`) through the real app and REAL Postgres: `all` is active + archived in the same
// sort_order/id order, paginates with the same cursor, counts both in page.total, and a value outside the enum
// is still a 400.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { createWorld, P, World } from './helpers/sharedWorld';
import { assertConforms } from './helpers/openapi';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('items status filter (real Postgres)', () => {
  let w: World;
  let listId: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    w = await createWorld(state);
    const a = w.api(P.aAdmin);
    listId = (await a.post('/v1/selection-lists', { key: 'status-all', name: 'Status all' })).body.id;
    ids = {};
    for (const code of ['A', 'B', 'C', 'D']) ids[code] = (await a.post(`/v1/selection-lists/${listId}/items`, { code, label: code })).body.id;
    expect((await a.post(`/v1/selection-lists/${listId}/items/${ids.B}/archive`)).status).toBe(200);
    expect((await a.post(`/v1/selection-lists/${listId}/items/${ids.D}/archive`)).status).toBe(200);
  });
  afterAll(() => w.teardown());

  const get = (qs: string, p = P.aAdmin) => w.api(p).get(`/v1/selection-lists/${listId}/items${qs}`);
  const codes = (r: any) => r.body.items.map((i: any) => i.code);

  it('default stays active; archived stays archived', async () => {
    expect(codes(await get(''))).toEqual(['A', 'C']);
    expect(codes(await get('?status=active'))).toEqual(['A', 'C']);
    expect(codes(await get('?status=archived'))).toEqual(['B', 'D']);
  });

  it('status=all returns every non-purged item in sort_order, with both statuses and a total over both', async () => {
    const res = await get('?status=all');
    expect(res.status).toBe(200);
    expect(codes(res)).toEqual(['A', 'B', 'C', 'D']);
    expect(res.body.items.map((i: any) => i.status)).toEqual(['active', 'archived', 'active', 'archived']);
    expect(res.body.page).toEqual({ nextCursor: null, hasMore: false, total: 4 });
    for (const i of res.body.items) assertConforms('SelectionListItem', i);
  });

  it('status=all pages deterministically with the cursor (no gaps, no duplicates)', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: any = await get(`?status=all&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      expect(res.body.page.total).toBe(4);
      seen.push(...codes(res));
      cursor = res.body.page.nextCursor;
      expect(res.body.page.hasMore).toBe(cursor !== null);
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(seen).toEqual(['A', 'B', 'C', 'D']);
  });

  it('clamps an over-max limit under status=all', async () => {
    const res = await get('?status=all&limit=9999');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(4);
  });

  it('a value outside the enum is still a 400 VALIDATION_ERROR', async () => {
    for (const bad of ['everything', 'ALL', 'purged', '']) {
      const res = await get(`?status=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('readability is unchanged: a caller who cannot read the list still gets 404 under status=all', async () => {
    const res = await get('?status=all', P.bMember);
    expect(res.status).toBe(404);
  });
});
