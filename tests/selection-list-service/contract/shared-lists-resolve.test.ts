/**
 * `POST /v1/resolve` across common lists and forks (SL9, D9).
 * Written against the FROZEN contract (openapi.yaml 4.1.0: "Common lists and forks (4.1.0)" on
 * `resolveSelectionListItems`, `ResolvedSelectionListItem.effective_item_id`) and
 * docs/planning/selection-lists-shared-and-fork.md. Needs the shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Design-record rows pinned (§11.9, D9, §4 "resolve item ids" row):
 *   - the resolvable set = the caller org's items PLUS the items of every `platform` list: a common list's ids
 *     resolve from EVERY org; another customer org's ids (`org` or `private`) still land in `missing`;
 *   - redirect: an id of a `platform` list P resolves to the item of the caller org's ACTIVE, `org`-visible fork F
 *     whose `origin_item_id` = id, and carries `effective_item_id` = the fork item's id (label / locale / status are
 *     the fork item's — including `archived`); both ids keep resolving; the other org (no fork) is unaffected;
 *   - a `private` fork never redirects (a draft is not the org's choice) — not even for its owner; an archived fork
 *     list never redirects; an item PURGED from the fork falls back to the common item;
 *   - `effective_item_id` is absent whenever no redirect happened; the response stays minimal (label / locale /
 *     is_machine / status [+ effective_item_id]);
 *   - the id batch is accounted for in `results` + `missing` (never silently dropped);
 *   - cache correctness: the response varies with fork presence — its ETag changes when the org forks, so a client
 *     revalidating with the pre-fork ETag does not get a stale 304.
 */
import {
  actor, addItem, call, createList, createPlatformList, forkList, L, newOrg, assertSharedListsOn, walkItems,
  type Actor, type ItemLike, type PlatformListFixture,
} from '../helpers/shared-lists';
import { SERVICE_BASE_URL } from '../helpers/client';
import { assertResponse } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const ORG_1 = newOrg('rsv1'); // forks
const ORG_2 = newOrg('rsv2'); // never forks
const a1 = actor('a1', ORG_1, 'admin');
const v1 = actor('v1', ORG_1, 'viewer'); // a plain member of the forking org
const a2 = actor('a2', ORG_2, 'admin');
const v2 = actor('v2', ORG_2, 'viewer');

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

const resolve = (who: Actor, ids: string[], locale?: string) => call(who, 'POST', '/v1/resolve', { ids, ...(locale ? { locale } : {}) });
const ALLOWED = ['label', 'locale', 'is_machine', 'status', 'effective_item_id'];

async function forkWithItems(p: PlatformListFixture, who: Actor = a1, body?: unknown) {
  const res = await forkList(who, p.list.id, body);
  expect(res.status).toBe(201);
  const items = await walkItems(who, res.body.id, 'all');
  const byCode = new Map(items.map((i) => [i.code, i]));
  return { fork: res.body, byCode };
}

describe('platform ids resolve from every org', () => {
  it('members of two unrelated orgs resolve the common list\'s ids; no redirect, minimal shape, ids fully accounted for', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B', 'C'] });
    const ids = p.items.map((i) => i.id);
    for (const who of [v1, v2]) {
      const res = await resolve(who, [...ids, 'front_sli_01sl9neverexisted0000']);
      expect(res.status).toBe(200);
      assertResponse('POST', '/v1/resolve', 200, res.body);
      for (const it of p.items) {
        expect(res.body.results[it.id]).toMatchObject({ label: it.label, status: 'active' });
        expect(Object.keys(res.body.results[it.id]).every((k) => ALLOWED.includes(k))).toBe(true);
        expect(res.body.results[it.id].effective_item_id).toBeUndefined();
      }
      expect(res.body.missing).toEqual(['front_sli_01sl9neverexisted0000']);
      expect(Object.keys(res.body.results).length + res.body.missing.length).toBe(ids.length + 1);
    }
  });

  it('a purged common item is `missing` for everyone (while its siblings still resolve)', async () => {
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    expect((await call(p.owner, 'DELETE', `${L(p.list.id)}/items/${p.items[0].id}?purge=true`)).status).toBe(204);
    const res = await resolve(v2, p.items.map((i) => i.id));
    expect(res.body.missing).toEqual([p.items[0].id]);
    expect(Object.keys(res.body.results)).toEqual([p.items[1].id]);
  });
});

describe('another customer org\'s ids are still `missing` (no existence oracle)', () => {
  it('`org` and `private` items of ORG_2 are missing for ORG_1 — and resolve for ORG_2 itself', async () => {
    const orgList = await createList(a2, { name: 'ORG_2 shared', visibility: 'org' });
    const privList = await createList(a2, { name: 'ORG_2 private' });
    const orgItem = await addItem(a2, orgList.id, 'X');
    const privItem = await addItem(a2, privList.id, 'Y');
    const foreign = await resolve(v1, [orgItem.id, privItem.id]);
    expect(foreign.status).toBe(200);
    expect(foreign.body.results).toEqual({});
    expect([...foreign.body.missing].sort()).toEqual([orgItem.id, privItem.id].sort());
    // controls: the owning org resolves both (L-4: no per-list read check), and for the org list a plain member too
    const own = await resolve(v2, [orgItem.id, privItem.id]);
    expect(Object.keys(own.body.results).sort()).toEqual([orgItem.id, privItem.id].sort());
    expect(own.body.missing).toEqual([]);
  });
});

describe('§11.9 / D9: the org-visible fork redirects the common ids', () => {
  let p: PlatformListFixture;
  let fork: any;
  let byCode: Map<string, ItemLike>;

  beforeAll(async () => {
    p = await createPlatformList({ itemCodes: ['A', 'B', 'C'] });
    ({ fork, byCode } = await forkWithItems(p));
  });

  it('a member of the forking org resolves the common id to the FORK item\'s text, naming effective_item_id; the fork id resolves too, without a redirect', async () => {
    const forkA = byCode.get('A')!;
    expect((await call(a1, 'PATCH', `${L(fork.id)}/items/${forkA.id}`, { label: 'Our A' })).status).toBe(200);
    const res = await resolve(v1, [p.items[0].id, forkA.id]);
    expect(res.status).toBe(200);
    assertResponse('POST', '/v1/resolve', 200, res.body);
    expect(res.body.results[p.items[0].id]).toMatchObject({ label: 'Our A', status: 'active', effective_item_id: forkA.id });
    expect(res.body.results[forkA.id]).toMatchObject({ label: 'Our A' });
    expect(res.body.results[forkA.id].effective_item_id).toBeUndefined();
    expect(res.body.missing).toEqual([]);
  });

  it('the other org (no fork) still gets the common text and no redirect (control: the redirect is per org)', async () => {
    const res = await resolve(v2, [p.items[0].id]);
    expect(res.body.results[p.items[0].id]).toMatchObject({ label: p.items[0].label });
    expect(res.body.results[p.items[0].id].effective_item_id).toBeUndefined();
  });

  it('every untouched item redirects too (identical text, but effective_item_id names the fork item)', async () => {
    const res = await resolve(v1, [p.items[1].id, p.items[2].id]);
    expect(res.body.results[p.items[1].id]).toMatchObject({ effective_item_id: byCode.get('B')!.id, label: p.items[1].label });
    expect(res.body.results[p.items[2].id]).toMatchObject({ effective_item_id: byCode.get('C')!.id });
  });

  it('an ARCHIVED fork item redirects with status "archived"', async () => {
    const forkB = byCode.get('B')!;
    expect((await call(a1, 'DELETE', `${L(fork.id)}/items/${forkB.id}`)).status).toBe(200);
    const res = await resolve(v1, [p.items[1].id]);
    expect(res.body.results[p.items[1].id]).toMatchObject({ status: 'archived', effective_item_id: forkB.id });
  });

  it('an item PURGED from the fork falls back to the common item (no redirect)', async () => {
    const forkC = byCode.get('C')!;
    expect((await call(a1, 'DELETE', `${L(fork.id)}/items/${forkC.id}?purge=true`)).status).toBe(204);
    const res = await resolve(v1, [p.items[2].id]);
    expect(res.body.results[p.items[2].id]).toMatchObject({ label: p.items[2].label, status: 'active' });
    expect(res.body.results[p.items[2].id].effective_item_id).toBeUndefined();
    // and the redirect for A is unaffected
    expect((await resolve(v1, [p.items[0].id])).body.results[p.items[0].id].effective_item_id).toBe(byCode.get('A')!.id);
  });

  it('an ARCHIVED fork list does not redirect; reactivating it restores the redirect', async () => {
    expect((await call(a1, 'POST', `${L(fork.id)}/archive`)).status).toBe(200);
    const off = await resolve(v1, [p.items[0].id]);
    expect(off.body.results[p.items[0].id]).toMatchObject({ label: p.items[0].label });
    expect(off.body.results[p.items[0].id].effective_item_id).toBeUndefined();
    expect((await call(a1, 'PATCH', L(fork.id), { status: 'active' })).status).toBe(200);
    expect((await resolve(v1, [p.items[0].id])).body.results[p.items[0].id].effective_item_id).toBe(byCode.get('A')!.id);
  });

  it('the redirect honours the requested locale (fork translations are copies of the common ones)', async () => {
    const q = await createPlatformList({ itemCodes: ['A'] });
    expect((await call(q.owner, 'PUT', `${L(q.list.id)}/items/${q.items[0].id}/translations/fr`, { label: 'Un' })).status).toBe(200);
    const { byCode: bc } = await forkWithItems(q);
    const res = await resolve(v1, [q.items[0].id], 'fr');
    expect(res.body.results[q.items[0].id]).toMatchObject({ label: 'Un', locale: 'fr', effective_item_id: bc.get('A')!.id });
  });
});

describe('§11.9 / D9: when the fork lacks the item, resolve falls back to the COMMON item in the COMMON list\'s source locale', () => {
  it('the common list is French, the fork re-sourced to Spanish and missing item A: A resolves to the common (French) text and locale, not the fork\'s Spanish source locale', async () => {
    const org5 = newOrg('rsv5');
    const a5 = actor('a5', org5, 'admin');
    const v5 = actor('v5', org5, 'viewer');
    const p = await createPlatformList({ itemCodes: ['A', 'B'], extra: { source_locale: 'fr' } });
    expect(p.list.source_locale).toBe('fr');
    const { fork, byCode } = await forkWithItems(p, a5);
    expect(fork.source_locale).toBe('fr');
    // give the fork Spanish text first (changing source_locale does not re-translate), then re-source it
    expect((await call(a5, 'PUT', `${L(fork.id)}/translations/es`, { name: 'Lista comun' })).status).toBe(200);
    expect((await call(a5, 'PUT', `${L(fork.id)}/items/${byCode.get('B')!.id}/translations/es`, { label: 'B en espanol' })).status).toBe(200);
    expect((await call(a5, 'PATCH', L(fork.id), { source_locale: 'es' })).status).toBe(200); // the fork now has a DIFFERENT source locale
    expect((await call(a5, 'DELETE', `${L(fork.id)}/items/${byCode.get('A')!.id}?purge=true`)).status).toBe(204); // ...and lacks item A

    const res = await resolve(v5, [p.items[0].id]);
    expect(res.status).toBe(200);
    const a = res.body.results[p.items[0].id];
    expect(a).toMatchObject({ label: p.items[0].label, status: 'active', locale: 'fr' }); // the common list's text, in the common list's source locale
    expect(a.effective_item_id).toBeUndefined(); // not redirected: the fork has no such item
    // control: B is still in the fork, so it redirects (the lookup really is per item)
    expect((await resolve(v5, [p.items[1].id])).body.results[p.items[1].id].effective_item_id).toBe(byCode.get('B')!.id);
  });
});

describe('§11.9: a private fork (a draft) never redirects', () => {
  it('not for members, not even for the fork\'s owner; publishing it to the org starts the redirect, unpublishing stops it', async () => {
    const org3 = newOrg('rsv3');
    const a3 = actor('a3', org3, 'admin');
    const v3 = actor('v3', org3, 'viewer');
    const p = await createPlatformList({ itemCodes: ['A'] });
    const { fork, byCode } = await forkWithItems(p, a3, { visibility: 'private' });
    expect(fork.visibility).toBe('private');
    for (const who of [v3, a3]) {
      const res = await resolve(who, [p.items[0].id]);
      expect(res.body.results[p.items[0].id].effective_item_id).toBeUndefined();
      expect(res.body.results[p.items[0].id].label).toBe(p.items[0].label);
    }
    expect((await call(a3, 'PATCH', L(fork.id), { visibility: 'org' })).status).toBe(200);
    expect((await resolve(v3, [p.items[0].id])).body.results[p.items[0].id].effective_item_id).toBe(byCode.get('A')!.id);
    expect((await call(a3, 'PATCH', L(fork.id), { visibility: 'private' })).status).toBe(200);
    expect((await resolve(v3, [p.items[0].id])).body.results[p.items[0].id].effective_item_id).toBeUndefined();
  });
});

describe('cache correctness: the response varies with fork presence', () => {
  it('the ETag is stable while nothing changes and DIFFERS once the org forks (a pre-fork validator can never match the post-fork representation)', async () => {
    const org4 = newOrg('rsv4');
    const a4 = actor('a4', org4, 'admin');
    const v4 = actor('v4', org4, 'viewer');
    const p = await createPlatformList({ itemCodes: ['A'] });
    const raw = (etag?: string) =>
      fetch(`${SERVICE_BASE_URL}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${v4.token()}`, ...(etag ? { 'if-none-match': etag } : {}) },
        body: JSON.stringify({ ids: [p.items[0].id] }),
      });
    const before = await raw();
    expect(before.status).toBe(200);
    const etag = before.headers.get('etag');
    expect(etag).toBeTruthy(); // the contract: resolve responses carry an ETag
    expect((await raw()).headers.get('etag')).toBe(etag); // control: an unchanged response has a stable validator

    expect((await forkList(a4, p.list.id)).status).toBe(201);
    const after = await raw(etag!);
    expect(after.status).toBe(200); // never a stale 304 for the pre-fork validator
    expect(after.headers.get('etag')).not.toBe(etag);
    const body = (await after.json()) as any;
    expect(body.results[p.items[0].id].effective_item_id).toMatch(/^front_sli_/);
  });
});
