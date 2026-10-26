/**
 * ONE effective row per key when an organization holds the same key under TWO renderings of its id - and the winner is
 * chosen among the rows the caller can READ (SL9, service 1.1.x). Written against the frozen contract (a `key` is "unique
 * within the organization"; the effective list for a key is the caller's own readable list, else the common one; a fork is
 * idempotent "per (organization, source)"; an unreadable list does not exist for the caller: 404, never 403), the design
 * record (D2 / D6 / §6) and the rollout runbook §10.1 ("at read time, with the flag ON, exactly one is effective: the one
 * the caller can read: active, the caller's own rendering, oldest, smallest id"). Needs the shared-lists flag ON
 * (helpers/shared-lists.ts).
 *
 * The API can no longer CREATE such a pair (a create / rename onto a key held under another rendering is a 409), so the pair
 * is planted as legacy data (helpers/renderings.ts); every assertion is made over HTTP, with readability decided by the
 * stand-in Security API exactly as in production (private list: an instance role; org list: `read_shared`).
 *
 * Rule pinned, per consumer: among the READABLE rows of the group, an ACTIVE row beats an archived one, then the row stored
 * under the caller's own claim, then the oldest, then the smallest id. (With two renderings the claim always separates the
 * two rows, so "oldest / smallest id" can only break a tie the claim already decided; they are not separately observable
 * and are not asserted.) An unreadable row is never the winner and never hides a readable duplicate or a common list.
 *   1. listing and `?key=` lookup (and shadowing of a common list of the same key);
 *   2. the paged listing shows each effective list exactly once, for every page size - a page may be SHORTER than `limit`;
 *   3. the fork lookup (the idempotent repeat of POST .../fork): the readable fork, else 409 `fork_exists`;
 *   4. resolve: a stored common item id redirects (`effective_item_id`) to the item of the readable fork, never to an
 *      unreadable one.
 */
import {
  actor, call, createPlatformList, denyCatalogAction, expectError, fixtureGrant, forkList, L, newCodecOrg, rnd, assertSharedListsOn,
  walkLists, type Actor, type ListLike,
} from '../helpers/shared-lists';
import { closeDb, dbQuery } from '../helpers/db';
import { canonicalUuid } from '../helpers/ids';
import { plantList } from '../helpers/renderings';

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

/** One org, a caller per rendering of its id (both `editor`: list / create / resolve / read_shared, no instance role anywhere). */
function orgWorld() {
  const org = newCodecOrg();
  return { ...org, byType: actor('dw-t', org.wire, 'editor'), byUuid: actor('dw-u', org.uuid, 'editor') };
}
type OrgWorld = ReturnType<typeof orgWorld>;
const key = (tag: string): string => `dw-${tag}-${rnd()}-${rnd()}`;
const ids = (rows: Array<{ id: string }>): string[] => rows.map((r) => r.id);
const roleOn = (w: OrgWorld, who: Actor, listId: string, role = 'list-viewer'): Promise<void> => fixtureGrant(w.wire, who.userId, listId, role);

/** `?key=` lookup, including shared, any status. */
const lookup = async (who: Actor, k: string, extra = ''): Promise<string[]> => {
  const res = await call(who, 'GET', `/v1/selection-lists?key=${encodeURIComponent(k)}&include_shared=true${extra}`);
  expect(res.status).toBe(200);
  return ids(res.body.items);
};

describe('1. the listing and the ?key= lookup return exactly ONE row, deterministically', () => {
  it('both rows readable: the row stored under the caller\'s own claim wins - whichever is older or newer - and the answer is stable', async () => {
    const w = orgWorld();
    for (const [typeAge, uuidAge] of [[5, 20], [20, 5]]) {
      const k = key('exact');
      const typeRow = await plantList({ storedOrg: w.wire, key: k, visibility: 'org', ageMinutes: typeAge });
      const uuidRow = await plantList({ storedOrg: w.uuid, key: k, visibility: 'org', ageMinutes: uuidAge });
      for (let i = 0; i < 3; i++) {
        expect(await lookup(w.byType, k)).toEqual([typeRow.id]);
        expect(await lookup(w.byUuid, k)).toEqual([uuidRow.id]);
      }
    }
  });

  it('an ACTIVE row beats an archived one, whatever the claim or the age', async () => {
    const w = orgWorld();
    const k = key('active');
    await plantList({ storedOrg: w.uuid, key: k, visibility: 'org', status: 'archived', ageMinutes: 60 }); // the caller's own claim, oldest, but archived
    const active = await plantList({ storedOrg: w.wire, key: k, visibility: 'org', ageMinutes: 1 });
    expect(await lookup(w.byUuid, k, '&status=all')).toEqual([active.id]);
    expect(await lookup(w.byUuid, k)).toEqual([active.id]);
  });

  it('PERMIT-AWARE: an unreadable private winner (the caller\'s exact claim, oldest) does not hide a readable duplicate, which also shadows the common list of that key', async () => {
    const w = orgWorld();
    const common = await createPlatformList({ key: key('shadow'), itemCodes: ['A'] });
    const unreadable = await plantList({ storedOrg: w.wire, key: common.list.key, visibility: 'private', ageMinutes: 30 }); // exact claim for byType, oldest, no role
    const readable = await plantList({ storedOrg: w.uuid, key: common.list.key, visibility: 'org', ageMinutes: 5 }); // the other rendering, read through read_shared
    for (const qs of [`?key=${common.list.key}&include_shared=true`, '?include_shared=true']) {
      const res = await call(w.byType, 'GET', `/v1/selection-lists${qs}`);
      expect(res.status).toBe(200);
      const mine = res.body.items.filter((r: ListLike) => r.key === common.list.key);
      expect({ qs, ids: ids(mine) }).toEqual({ qs, ids: [readable.id] }); // the readable duplicate: not nothing, not the common list, not the unreadable one
    }
    // an unreadable list does not exist for the caller (404, never 403); the readable one is served
    expectError(await call(w.byType, 'GET', L(unreadable.id)), 404, 'NOT_FOUND');
    expect((await call(w.byType, 'GET', L(readable.id))).status).toBe(200);
    // once the caller can read the private row too, the deterministic winner (its own claim) is back
    await roleOn(w, w.byType, unreadable.id);
    expect(await lookup(w.byType, common.list.key)).toEqual([unreadable.id]);
    // and the default listing (instance roles only) names the one it can read
    expect(ids((await walkLists(w.byType, `key=${common.list.key}`)).rows)).toEqual([unreadable.id]);
  });

  it('PERMIT-AWARE: NEITHER duplicate readable - the caller has no own row for the key, and the common list is NOT suppressed', async () => {
    const w = orgWorld();
    const common = await createPlatformList({ key: key('neither'), itemCodes: ['A'] });
    await plantList({ storedOrg: w.wire, key: common.list.key, visibility: 'private', ageMinutes: 10 });
    await plantList({ storedOrg: w.uuid, key: common.list.key, visibility: 'private', ageMinutes: 20 });
    expect(await lookup(w.byType, common.list.key)).toEqual([common.list.id]);
    expect(await lookup(w.byUuid, common.list.key)).toEqual([common.list.id]);
    expect(ids((await walkLists(w.byType, `key=${common.list.key}`)).rows)).toEqual([]); // the default listing is the caller's own readable lists only
  });

  it('a common key duplicated across the PLATFORM org\'s own renderings collapses to one list for any tenant', async () => {
    const w = orgWorld();
    const k = key('commondup');
    const configured = await createPlatformList({ key: k, itemCodes: ['A'] });
    // legacy duplicate of the same common key stored under the other rendering of the platform org
    const dup = await plantList({ storedOrg: canonicalUuid(configured.list.organization_id), key: k, visibility: 'platform', ageMinutes: 1 });
    for (const who of [w.byType, w.byUuid]) {
      const found = await lookup(who, k);
      expect(found).toHaveLength(1);
      expect(found).toEqual([configured.list.id]); // the configured platform id is every tenant's claim for the common group
      expect(found).not.toContain(dup.id);
    }
  });
});

describe('2. the paged listing shows each effective list exactly once, for every page size', () => {
  it('a readable winner per key, nothing for a key with no readable row; pages never exceed `limit` (they may be shorter) and the walk terminates', async () => {
    const w = orgWorld();
    const p = `dwp-${rnd()}${rnd()}`;
    // k1: private exact-claim winner + readable duplicate    -> the readable duplicate
    await plantList({ storedOrg: w.wire, key: `${p}-1`, visibility: 'private', ageMinutes: 10 });
    const k1u = await plantList({ storedOrg: w.uuid, key: `${p}-1`, visibility: 'org', ageMinutes: 11 });
    // k2: both readable                                       -> the caller's own claim
    const k2t = await plantList({ storedOrg: w.wire, key: `${p}-2`, visibility: 'org', ageMinutes: 12 });
    const k2u = await plantList({ storedOrg: w.uuid, key: `${p}-2`, visibility: 'org', ageMinutes: 13 });
    // k3: neither readable                                    -> nothing
    await plantList({ storedOrg: w.wire, key: `${p}-3`, visibility: 'private', ageMinutes: 14 });
    await plantList({ storedOrg: w.uuid, key: `${p}-3`, visibility: 'private', ageMinutes: 15 });
    // k4: a single readable row under one rendering          -> itself
    const k4u = await plantList({ storedOrg: w.uuid, key: `${p}-4`, visibility: 'org', ageMinutes: 16 });

    // (`visibility=org` keeps the walk to the org's own shared rows; the duplicate group of a row is still judged with its
    // private partner - that is the point of k1 and k3 - whichever page it is on)
    const walk = async (who: Actor, limit: number) => {
      const seen: ListLike[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { status: number; body: any } = await call(who, 'GET', `/v1/selection-lists?include_shared=true&visibility=org&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeLessThanOrEqual(limit);
        seen.push(...res.body.items.filter((r: ListLike) => r.key.startsWith(p)));
        cursor = res.body.page.nextCursor;
        if (++pages > 500) throw new Error('listing walk did not terminate');
      } while (cursor);
      return seen;
    };
    for (const limit of [1, 2, 3, 50]) {
      const seen = await walk(w.byType, limit);
      expect({ limit, rows: seen.map((r) => [r.key, r.id]).sort() }).toEqual({
        limit,
        rows: [[`${p}-1`, k1u.id], [`${p}-2`, k2t.id], [`${p}-4`, k4u.id]].sort(),
      });
    }
    // the other rendering's caller resolves k2 to ITS claim's row (k1's private row is unreadable for it too)
    const seenUuid = await walk(w.byUuid, 2);
    expect(seenUuid.map((r) => [r.key, r.id]).sort()).toEqual([[`${p}-1`, k1u.id], [`${p}-2`, k2u.id], [`${p}-4`, k4u.id]].sort());
  });
});

describe('3. the fork lookup (POST .../fork is idempotent per (organization, source)) answers the READABLE fork', () => {
  /** A common list and an org holding a fork of it under EACH rendering of its id (visibility `private`: readable only by an instance role). */
  async function twoForks(visibility: 'private' | 'org') {
    const w = orgWorld();
    const source = await createPlatformList({ key: key('fork'), itemCodes: ['A', 'B'] });
    const typeFork = await plantList({ storedOrg: w.wire, key: source.list.key, visibility, ageMinutes: 10, forkOf: { listId: source.list.id, orgWire: source.list.organization_id } });
    const uuidFork = await plantList({ storedOrg: w.uuid, key: source.list.key, visibility, ageMinutes: 20, forkOf: { listId: source.list.id, orgWire: source.list.organization_id } });
    return { w, source, typeFork, uuidFork };
  }

  it('private forks: none readable -> 409 fork_exists; a role on one -> that fork (200) even though the other is the caller\'s own claim; a role on both -> the own claim', async () => {
    const { w, source, typeFork, uuidFork } = await twoForks('private');
    const none = await forkList(w.byType, source.list.id);
    expectError(none, 409, 'CONFLICT', 'fork_exists');
    await roleOn(w, w.byType, uuidFork.id);
    for (let i = 0; i < 2; i++) {
      const readable = await forkList(w.byType, source.list.id);
      expect({ status: readable.status, id: readable.body.id }).toEqual({ status: 200, id: uuidFork.id });
    }
    await roleOn(w, w.byType, typeFork.id);
    const both = await forkList(w.byType, source.list.id);
    expect({ status: both.status, id: both.body.id }).toEqual({ status: 200, id: typeFork.id });
    // nothing was copied: still exactly the two planted forks
    expect((await dbQuery('SELECT 1 FROM selection_lists WHERE forked_from_list_id = $1', [source.list.id])).length).toBe(2);
  });

  it('org-visible forks (both readable): the repeat answers the caller\'s own claim\'s fork, for either rendering, stably', async () => {
    const { w, source, typeFork, uuidFork } = await twoForks('org');
    for (let i = 0; i < 2; i++) {
      const t = await forkList(w.byType, source.list.id);
      expect({ status: t.status, id: t.body.id }).toEqual({ status: 200, id: typeFork.id });
      const u = await forkList(w.byUuid, source.list.id);
      expect({ status: u.status, id: u.body.id }).toEqual({ status: 200, id: uuidFork.id });
    }
  });
});

describe('4. resolve redirects a stored common item id to the item of the READABLE fork', () => {
  async function forksWithItems() {
    const w = orgWorld();
    const source = await createPlatformList({ key: key('resolve'), itemCodes: ['LOW'] });
    const origin = source.items[0]!.id;
    const forkOf = { listId: source.list.id, orgWire: source.list.organization_id };
    const typeFork = await plantList({ storedOrg: w.wire, key: source.list.key, visibility: 'org', ageMinutes: 10, forkOf, itemCodes: ['LOW'], originOf: [origin] });
    const uuidFork = await plantList({ storedOrg: w.uuid, key: source.list.key, visibility: 'org', ageMinutes: 20, forkOf, itemCodes: ['LOW'], originOf: [origin] });
    return { w, origin, typeFork, uuidFork };
  }
  const effective = async (who: Actor, itemId: string): Promise<string | undefined> => {
    const res = await call(who, 'POST', '/v1/resolve', { ids: [itemId] });
    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([]);
    return res.body.results[itemId].effective_item_id;
  };

  it('both forks readable: the caller\'s own claim\'s fork item, for either rendering, stably', async () => {
    const { w, origin, typeFork, uuidFork } = await forksWithItems();
    for (let i = 0; i < 3; i++) {
      expect(await effective(w.byType, origin)).toBe(typeFork.itemIds[0]);
      expect(await effective(w.byUuid, origin)).toBe(uuidFork.itemIds[0]);
    }
  });

  it('PERMIT-AWARE: a caller without the shared read reaches a fork only through an instance role - none readable -> no redirect (the common item); a role on one -> that fork\'s item; a role on both -> its own claim\'s', async () => {
    const { w, origin, typeFork, uuidFork } = await forksWithItems();
    await denyCatalogAction(w.wire, w.byType.userId, 'read_shared'); // still holds `resolve`; no longer a shared reader
    expect(await effective(w.byType, origin)).toBeUndefined();
    await roleOn(w, w.byType, uuidFork.id);
    for (let i = 0; i < 2; i++) expect(await effective(w.byType, origin)).toBe(uuidFork.itemIds[0]);
    await roleOn(w, w.byType, typeFork.id);
    expect(await effective(w.byType, origin)).toBe(typeFork.itemIds[0]);
    // a different caller of the same org, with the shared read, is unaffected by the first caller's roles
    expect(await effective(w.byUuid, origin)).toBe(uuidFork.itemIds[0]);
  });
});
