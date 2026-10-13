/**
 * Listing shared / common lists (SL9) — `GET /v1/selection-lists` with `include_shared` and `visibility`.
 * Written against the FROZEN contract (openapi.yaml 4.1.0, `listSelectionLists`) and the design record
 * docs/planning/selection-lists-shared-and-fork.md. Needs the shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Design-record rows pinned:
 *   §11.3 / D13   `include_shared=true` adds exactly the rows the caller can read through visibility (own `org`
 *                 lists, `platform` common lists); default (`false`) is the 4.0.0 result set; shadowing (a common
 *                 list whose key the caller's org shadows with a readable own active list is omitted);
 *                 a `visibility` filter selects one value and DISABLES shadowing; pagination (cursor walk, no
 *                 gaps / dupes, limit enforced) is unchanged by the new parameters.
 *   §4 matrix     "appear in GET list": `private` -> instance read; `org` -> include_shared=true + member;
 *                 `platform` -> include_shared=true + member (unless shadowed); other customer org -> never.
 *   D13           every row carries `visibility`, `forked_from`, `editable`; `editable` is the caller-relative
 *                 write hint (true for every write role, false for list-viewer and for shared-read-only rows).
 *   §7 (ON)       with the flag ON the service always emits the 4.1.0 response fields (`visibility`,
 *                 `forked_from`, `editable` on lists; `origin_item_id` on items).
 *   x-pagination (pagination-standard.md): envelope `{ items, page: { nextCursor, hasMore } }`, `limit` clamped.
 */
import {
  actor, addItem, call, createList, createPlatformList, expectError, forkList, L, newOrg, PLATFORM_ORG_ID, rnd,
  assertSharedListsOn, walkLists, type ListLike,
} from '../helpers/shared-lists';
import { assertResponse } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const ORG_L = newOrg('lstl');
const ORG_M = newOrg('lstm');
const owner = actor('own', ORG_L, 'admin');
const viewer = actor('vw', ORG_L, 'viewer');
const mViewer = actor('mvw', ORG_M, 'viewer');

let lp: ListLike; // private
let lo: ListLike; // org
let la: ListLike; // org, archived
let plat1: ListLike;
let plat2: ListLike;

beforeAll(async () => {
  await assertSharedListsOn();
  lp = await createList(owner, { name: 'Listing private' });
  lo = await createList(owner, { name: 'Listing org', visibility: 'org' });
  la = await createList(owner, { name: 'Listing org archived', visibility: 'org' });
  expect((await call(owner, 'POST', `${L(la.id)}/archive`)).status).toBe(200);
  plat1 = (await createPlatformList({ name: 'Listing common 1' })).list;
  plat2 = (await createPlatformList({ name: 'Listing common 2' })).list;
});
afterAll(async () => {
  await closeDb();
});

const ids = (rows: ListLike[]): string[] => rows.map((r) => r.id);

describe('response shape with the flag ON: 4.1.0 fields are always emitted and conform to the spec', () => {
  it('a created list reports visibility "private", forked_from null, editable true (the owner), and conforms to SelectionList', async () => {
    const res = await call(owner, 'POST', '/v1/selection-lists', { key: `shape-${rnd()}`, name: 'Shape' });
    expect(res.status).toBe(201);
    assertResponse('POST', '/v1/selection-lists', 201, res.body);
    expect(res.body.visibility).toBe('private');
    expect(res.body.forked_from).toBeNull();
    expect(res.body.editable).toBe(true);
  });

  it('listing rows (default and include_shared) carry visibility / forked_from / editable and conform to the page schema', async () => {
    for (const qs of ['', '?include_shared=true']) {
      const res = await call(viewer, 'GET', `/v1/selection-lists${qs}`);
      expect(res.status).toBe(200);
      assertResponse('GET', '/v1/selection-lists', 200, res.body);
      expect(res.body.page).toHaveProperty('hasMore');
      for (const row of res.body.items as ListLike[]) {
        expect(['private', 'org', 'platform']).toContain(row.visibility);
        expect(row).toHaveProperty('forked_from');
        expect(typeof row.editable).toBe('boolean');
      }
    }
  });

  it('items report origin_item_id: null unless forked (flag ON always emits it)', async () => {
    const it1 = await addItem(owner, lo.id, `I${rnd()}`);
    expect(it1.origin_item_id).toBeNull();
    const res = await call(viewer, 'GET', `${L(lo.id)}/items`);
    assertResponse('GET', '/v1/selection-lists/{listId}/items', 200, res.body);
    for (const row of res.body.items) expect(row.origin_item_id).toBeNull();
  });
});

describe('§11.3: include_shared adds the right rows — and only those', () => {
  it('default listing (include_shared omitted / false) is the 4.0.0 set: grant-holders only, no shared rows', async () => {
    for (const qs of ['', 'include_shared=false']) {
      const mine = (await walkLists(owner, qs)).rows;
      expect(ids(mine)).toEqual(expect.arrayContaining([lp.id, lo.id])); // the owner holds instance roles on its own lists
      expect(ids(mine)).not.toContain(plat1.id); // a common list is not on its list unless asked
      const theirs = (await walkLists(viewer, qs)).rows;
      expect(ids(theirs)).not.toContain(lo.id); // visibility alone adds nothing without the opt-in
      expect(ids(theirs)).not.toContain(plat1.id);
    }
  });

  it('a member of the owning org with include_shared=true gets the `org` list + every common list, not the `private` one', async () => {
    const rows = (await walkLists(viewer, 'include_shared=true')).rows;
    expect(ids(rows)).toEqual(expect.arrayContaining([lo.id, plat1.id, plat2.id]));
    expect(ids(rows)).not.toContain(lp.id);
    expect(ids(rows)).not.toContain(la.id); // archived: the default status filter is `active`
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(lo.id)).toMatchObject({ visibility: 'org', organization_id: ORG_L, editable: false });
    expect(byId.get(plat1.id)).toMatchObject({ visibility: 'platform', organization_id: PLATFORM_ORG_ID, editable: false });
    // control: the owner sees the private list too, and is allowed to edit its own lists
    const own = new Map((await walkLists(owner, 'include_shared=true')).rows.map((r) => [r.id, r]));
    expect(own.get(lp.id)).toMatchObject({ visibility: 'private', editable: true });
    expect(own.get(lo.id)).toMatchObject({ editable: true });
    expect(own.get(plat1.id)).toMatchObject({ editable: false }); // shared-read only: "fork to edit"
  });

  it('a member of ANOTHER org gets the common lists but never this org\'s `org` or `private` lists', async () => {
    const rows = (await walkLists(mViewer, 'include_shared=true')).rows;
    expect(ids(rows)).toEqual(expect.arrayContaining([plat1.id, plat2.id]));
    expect(ids(rows)).not.toContain(lo.id);
    expect(ids(rows)).not.toContain(lp.id);
    for (const r of rows) expect([ORG_M, PLATFORM_ORG_ID]).toContain(r.organization_id);
  });

  it('an `org` list owned by the platform org is NOT shared with customer orgs (only `platform` crosses the boundary)', async () => {
    const op = actor('pop', PLATFORM_ORG_ID, 'admin');
    const platOrgList = await createList(op, { name: 'Platform org internal', visibility: 'org' });
    const rows = (await walkLists(viewer, 'include_shared=true')).rows;
    expect(ids(rows)).not.toContain(platOrgList.id);
    const platMember = actor('pmem', PLATFORM_ORG_ID, 'viewer');
    expect(ids((await walkLists(platMember, 'include_shared=true')).rows)).toContain(platOrgList.id); // control: its own org does
  });

  it('editable is the caller-relative WRITE hint: true for every write role, false for list-viewer', async () => {
    const le = await createList(owner, { name: 'Editable matrix' });
    const holders = {
      'list-editor': actor('hle', ORG_L, 'viewer'),
      'list-contributor': actor('hlc', ORG_L, 'viewer'),
      'list-translator': actor('hlt', ORG_L, 'viewer'),
      'list-viewer': actor('hlv', ORG_L, 'viewer'),
    } as const;
    for (const [role, who] of Object.entries(holders)) {
      expect((await call(owner, 'PUT', `${L(le.id)}/access/${who.userId}`, { role })).status).toBe(200);
    }
    const expected: Record<string, boolean> = { 'list-editor': true, 'list-contributor': true, 'list-translator': true, 'list-viewer': false };
    for (const [role, who] of Object.entries(holders)) {
      const rows = (await walkLists(who, '')).rows;
      const row = rows.find((r) => r.id === le.id);
      expect({ role, found: Boolean(row) }).toEqual({ role, found: true });
      expect({ role, editable: row!.editable }).toEqual({ role, editable: expected[role] });
    }
  });
});

describe('§11.3 / D8: shadowing and the `visibility` filter', () => {
  it('a common list shadowed by a readable own fork (same key) is omitted; other orgs still see it; the fork shows instead', async () => {
    const shadowed = (await createPlatformList({ name: 'To be shadowed' })).list;
    const fork = await forkList(owner, shadowed.id);
    expect(fork.status).toBe(201);
    expect(fork.body.key).toBe(shadowed.key);
    const rows = (await walkLists(viewer, 'include_shared=true')).rows; // viewer reads the fork through `org` visibility
    expect(ids(rows)).toContain(fork.body.id);
    expect(ids(rows)).not.toContain(shadowed.id);
    // another org has no fork: the common list is NOT omitted there (control: shadowing is per org)
    const other = (await walkLists(mViewer, 'include_shared=true')).rows;
    expect(ids(other)).toContain(shadowed.id);
    expect(ids(other)).not.toContain(fork.body.id);
  });

  it('a `visibility` filter turns shadowing off and selects exactly one visibility', async () => {
    const shadowed = (await createPlatformList({ name: 'Shadow, filtered' })).list;
    const fork = await forkList(owner, shadowed.id);
    expect(fork.status).toBe(201);

    const platOnly = (await walkLists(viewer, 'include_shared=true&visibility=platform')).rows;
    expect(ids(platOnly)).toContain(shadowed.id); // the common list behind the org's fork is visible again
    for (const r of platOnly) expect(r.visibility).toBe('platform');
    expect(ids(platOnly)).not.toContain(fork.body.id);

    const orgOnly = (await walkLists(viewer, 'include_shared=true&visibility=org')).rows;
    expect(ids(orgOnly)).toEqual(expect.arrayContaining([lo.id, fork.body.id]));
    for (const r of orgOnly) expect(r.visibility).toBe('org');
    expect(ids(orgOnly)).not.toContain(plat1.id);
    expect(ids(orgOnly)).not.toContain(lp.id);

    const privOnly = (await walkLists(owner, 'include_shared=true&visibility=private')).rows;
    expect(ids(privOnly)).toContain(lp.id);
    for (const r of privOnly) expect(r.visibility).toBe('private');
    expect(ids(privOnly)).not.toContain(lo.id);
  });

  it('a caller outside the platform org sees `platform` rows only WITH include_shared=true', async () => {
    const without = (await walkLists(viewer, 'visibility=platform')).rows;
    expect(ids(without)).not.toContain(plat1.id);
    const withShared = (await walkLists(viewer, 'visibility=platform&include_shared=true')).rows;
    expect(ids(withShared)).toEqual(expect.arrayContaining([plat1.id, plat2.id]));
  });

  it('rejects an unknown visibility / a non-boolean include_shared with 400 VALIDATION_ERROR', async () => {
    expectError(await call(viewer, 'GET', '/v1/selection-lists?visibility=public'), 400, 'VALIDATION_ERROR');
    expectError(await call(viewer, 'GET', '/v1/selection-lists?include_shared=maybe'), 400, 'VALIDATION_ERROR');
    expect((await call(viewer, 'GET', '/v1/selection-lists?visibility=org&include_shared=true')).status).toBe(200); // control
  });
});

describe('the ITEMS of a common list are pageable by a shared reader (x-pagination: cursor, limit enforced)', () => {
  it('a member with no grant walks a 5-item common list with limit=2: every item once, hasMore agrees with nextCursor, ends with nextCursor null', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B', 'C', 'D', 'E'] });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await call(viewer, 'GET', `${L(p.list.id)}/items?${qs}`);
      expect(res.status).toBe(200);
      assertResponse('GET', '/v1/selection-lists/{listId}/items', 200, res.body);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.page.hasMore).toBe(res.body.page.nextCursor !== null);
      seen.push(...res.body.items.map((i: any) => i.id));
      cursor = res.body.page.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual(p.items.map((i) => i.id).sort()); // no gaps, no dupes
  });

  it('limit is clamped to 200 for a shared reader too, and a malformed cursor is 400', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const big = await call(viewer, 'GET', `${L(p.list.id)}/items?limit=9999`);
    expect(big.status).toBe(200);
    expect(big.body.items.length).toBeLessThanOrEqual(200);
    expectError(await call(viewer, 'GET', `${L(p.list.id)}/items?cursor=NOT_A_REAL_CURSOR`), 400, 'VALIDATION_ERROR');
  });
});

describe('pagination is unchanged by include_shared (cursor walk without gaps / dupes; limit enforced)', () => {
  const ORG_P = newOrg('lstp');
  const pOwner = actor('pown', ORG_P, 'admin');
  const pMember = actor('pmem', ORG_P, 'viewer');
  const mine: ListLike[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) mine.push(await createList(pOwner, { name: `Paged ${i}`, visibility: 'org' }));
  });

  it('walking with limit=2 visits every row exactly once, terminates, and finds all own + common lists', async () => {
    const { rows, pages } = await walkLists(pMember, 'include_shared=true', 2);
    const seen = ids(rows);
    expect(new Set(seen).size).toBe(seen.length); // no dupes
    for (const l of mine) expect(seen).toContain(l.id); // no gaps
    expect(seen).toEqual(expect.arrayContaining([plat1.id, plat2.id]));
    expect(pages).toBeGreaterThanOrEqual(Math.ceil((mine.length + 2) / 2));
  });

  it('each page is at most `limit` rows, hasMore agrees with nextCursor, and the final page has nextCursor null / hasMore false', async () => {
    let cursor: string | null = null;
    let last: any = null;
    let guard = 0;
    do {
      const qs: string = `include_shared=true&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await call(pMember, 'GET', `/v1/selection-lists?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.page.hasMore).toBe(res.body.page.nextCursor !== null);
      last = res.body;
      cursor = res.body.page.nextCursor;
    } while (cursor && ++guard < 500);
    expect(last.page).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it('page order is stable: the relative order of known rows is identical for limit=2 and limit=200', async () => {
    const known = new Set([...mine.map((l) => l.id), plat1.id, plat2.id]);
    const small = ids((await walkLists(pMember, 'include_shared=true', 2)).rows).filter((i) => known.has(i));
    const big = ids((await walkLists(pMember, 'include_shared=true', 200)).rows).filter((i) => known.has(i));
    expect(small).toEqual(big);
  });

  it('a row created between two pages causes no duplicate (the cursor is a keyset, not an offset)', async () => {
    const first = await call(pMember, 'GET', '/v1/selection-lists?include_shared=true&limit=2');
    expect(first.body.page.nextCursor).not.toBeNull();
    await createList(pOwner, { name: 'Created mid-walk', visibility: 'org' });
    const seen = ids(first.body.items);
    let cursor: string | null = first.body.page.nextCursor;
    let guard = 0;
    while (cursor && guard++ < 500) {
      const res = await call(pMember, 'GET', `/v1/selection-lists?include_shared=true&limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(res.status).toBe(200);
      seen.push(...ids(res.body.items));
      cursor = res.body.page.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('limit is clamped to the declared max (200): an over-max request never returns more', async () => {
    const res = await call(pMember, 'GET', '/v1/selection-lists?include_shared=true&limit=9999');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(200);
    const tiny = await call(pMember, 'GET', '/v1/selection-lists?include_shared=true&limit=1');
    expect(tiny.body.items.length).toBe(1); // control: a small limit is honoured
  });

  it('a malformed cursor is a 400 VALIDATION_ERROR with include_shared too (never a silent reset to page 1)', async () => {
    expectError(await call(pMember, 'GET', '/v1/selection-lists?include_shared=true&cursor=NOT_A_REAL_CURSOR'), 400, 'VALIDATION_ERROR');
  });
});
