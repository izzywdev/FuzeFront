/**
 * Access grants across the renderings of one id: ONE grant GROUP per user (SL9, service 1.1.x; src/routes/access.ts).
 * Written against the frozen contract (openapi.yaml: GET/PUT/DELETE `/v1/selection-lists/{listId}/access[/{userId}]` -
 * "roles do not stack: PUT replaces", DELETE idempotent, "the last list-owner cannot be demoted or removed" -> 409, the
 * cursor-paginated roster) and the rollout runbook (§10.1 "Access mirror rows under both renderings of one user"), not
 * against the handlers.
 *
 * Why this exists: a list that predates the rendering-aware code can hold mirror rows (`selection_list_access`) for BOTH
 * renderings of one user - the bare UUID the Security API is sent and the `usr_...` TypeID - because the primary key
 * `(list_id, user_id)` is an exact string. The API can no longer create that state (a PUT converges the user to one row), so
 * it is planted as legacy data (helpers/renderings.ts) together with the authority roles the Security API holds for it,
 * and every ASSERTION is made over HTTP and against the stand-in Security API. The rows are ONE logical grant:
 *   1. GET lists the user ONCE, as its deterministic survivor (the row stored under the Permit key form = the bare UUID);
 *   2. DELETE revokes EVERY row - mirror and authority - so the user ends with no access, and a repeat is still 204;
 *   3. PUT converges the group to exactly ONE live row holding the new role, and the authority to exactly that role
 *      (roles do not stack), whichever roles the rows held;
 *   4. the last-owner guard counts the pair as ONE owner, and a user is an owner when ANY of its rows is - so a sole owner
 *      stored under two renderings can still be neither demoted nor removed;
 *   5. a paged walk of the roster visits every logical user exactly once and terminates (pagination standard);
 *   6. the ORG id is one group too: with the shared-lists flag ON a manager whose token carries the OTHER rendering of the
 *      list's org manages its access; with the flag OFF the 4.0.0 exact scope still hides the list from it (404).
 * The group rules are flag-independent: sections 1-5 run against the flag-ON instance AND the flag-OFF one
 * (SHARED_LISTS_FLAG_OFF_URL; a missing URL fails the suite, never skips it).
 */
import {
  actor, assertSharedListsOff, assertSharedListsOn, call, createList, expectError, FAKE_SECURITY_URL, fixtureGrant, FLAG_OFF_BASE_URL, L, newOrg, newUser, rnd,
  type Actor, type ListLike,
} from '../helpers/shared-lists';
import { mintTestToken } from '../helpers/auth';
import { closeDb } from '../helpers/db';
import { canonicalUuid } from '../helpers/ids';
import { accessRowsOf, liveAccessRowsOf, orgForms, plantAccessRow, userForms } from '../helpers/renderings';

const INSTANCES: Array<[string, string | undefined]> = [
  ['shared-lists flag ON', undefined],
  ['shared-lists flag OFF', FLAG_OFF_BASE_URL],
];

beforeAll(async () => {
  await assertSharedListsOn();
  await assertSharedListsOff(FLAG_OFF_BASE_URL); // throws the explicit PRECONDITION when the OFF instance is missing
});
afterAll(async () => {
  await closeDb();
});

/** A caller who is user `userId` acting in `orgClaim` (either rendering of an org id) with tenant role `admin`. */
const asUser = (userId: string, orgClaim: string): Actor => ({
  userId,
  orgId: orgClaim,
  role: 'admin',
  token: () => mintTestToken({ userId, organizationId: orgClaim, roles: ['admin'] }),
});

interface World {
  url: string | undefined;
  org: string;
  owner: Actor;
  list: ListLike;
  path: string;
}

async function world(url: string | undefined): Promise<World> {
  const org = newOrg('agrp');
  const owner = actor('ag-own', org, 'admin');
  const list = await createList(owner, { name: 'Grant groups', key: `ag-${rnd()}-${rnd()}` }, url);
  return { url, org, owner, list, path: L(list.id) };
}

/**
 * The legacy state: `user` holds a mirror row under EACH rendering of its id, with `uuidRole` on the bare UUID row and
 * `typeRole` on the TypeID row (the TypeID row is the OLDER one, so a "oldest wins" survivor rule would pick it). The
 * authority (the stand-in) holds both roles, as it would for grants that were really made.
 */
async function plantPair(w: World, user: string, uuidRole: string, typeRole: string): Promise<void> {
  const [typeUser, uuidUser] = userForms(user);
  const [typeOrg, uuidOrg] = orgForms(w.org);
  const [typeBy, uuidBy] = userForms(w.owner.userId);
  await plantAccessRow({ listId: w.list.id, storedUser: uuidUser, storedOrg: uuidOrg, role: uuidRole, grantedBy: uuidBy, grantedAt: new Date('2026-01-02T00:00:00Z') });
  await plantAccessRow({ listId: w.list.id, storedUser: typeUser, storedOrg: typeOrg, role: typeRole, grantedBy: typeBy, grantedAt: new Date('2026-01-01T00:00:00Z') });
  for (const role of new Set([uuidRole, typeRole])) await fixtureGrant(w.org, user, w.list.id, role);
}

/** The per-list roles the Security API (the stand-in) holds for `user` on the world's list. */
async function authorityRoles(w: World, user: string): Promise<string[]> {
  const res = await fetch(`${FAKE_SECURITY_URL}/api/v1/security/authz/grants?tenant=${encodeURIComponent(w.org)}&subject=${encodeURIComponent(user)}`, {
    headers: { authorization: `Bearer ${w.owner.token()}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ role: string; resource?: { key?: string } }> };
  return body.items.filter((g) => g.resource?.key === w.list.id).map((g) => g.role).sort();
}

/** Walk GET .../access to the end with the opaque cursor. */
async function walkRoster(w: World, limit: number): Promise<Array<{ user_id: string; role: string }>> {
  const rows: Array<{ user_id: string; role: string }> = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res: { status: number; body: any } = await call(w.owner, 'GET', `${w.path}/access?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, w.url);
    if (res.status !== 200) throw new Error(`roster walk -> ${res.status} ${JSON.stringify(res.body)}`);
    expect(res.body.items.length).toBeLessThanOrEqual(limit); // `limit` is a ceiling; a page may be shorter (a skipped partner row)
    rows.push(...res.body.items);
    cursor = res.body.page.nextCursor as string | null;
    if (++pages > 100) throw new Error('roster walk did not terminate');
  } while (cursor);
  return rows;
}

const COMBOS: Array<[string, string]> = [
  ['list-owner', 'list-viewer'],
  ['list-viewer', 'list-owner'],
  ['list-viewer', 'list-viewer'],
  ['list-editor', 'list-contributor'],
];

describe.each(INSTANCES)('%s', (_label, url) => {
  describe.each(COMBOS)('a user with mirror rows under BOTH renderings: bare UUID = %s, usr_ = %s', (uuidRole, typeRole) => {
    it('GET lists the user ONCE, as the survivor (the bare-UUID row, though the TypeID row is older), with the wire (usr_) id', async () => {
      const w = await world(url);
      const target = newUser('ag-t');
      await plantPair(w, target, uuidRole, typeRole);
      expect((await accessRowsOf(w.list.id, target)).length).toBe(2); // fixture sanity: two stored rows
      const roster = await walkRoster(w, 50);
      const mine = roster.filter((g) => canonicalUuid(g.user_id) === canonicalUuid(target));
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ user_id: target, role: uuidRole });
      expect(roster.filter((g) => canonicalUuid(g.user_id) === canonicalUuid(w.owner.userId))).toHaveLength(1); // the creator, once
    });

    it('DELETE revokes EVERY row (mirror and authority): the user ends with no access; a repeat is still 204', async () => {
      const w = await world(url);
      const target = newUser('ag-t');
      await plantPair(w, target, uuidRole, typeRole);
      expect((await authorityRoles(w, target)).length).toBeGreaterThan(0); // fixture sanity
      const res = await call(w.owner, 'DELETE', `${w.path}/access/${target}`, undefined, url);
      expect(res.status).toBe(204);
      expect(await liveAccessRowsOf(w.list.id, target)).toHaveLength(0);
      expect((await accessRowsOf(w.list.id, target)).every((r) => r.revoked_at !== null)).toBe(true); // soft-revoked, both
      expect(await authorityRoles(w, target)).toEqual([]); // nothing left at the authority either
      expect((await walkRoster(w, 50)).filter((g) => canonicalUuid(g.user_id) === canonicalUuid(target))).toHaveLength(0);
      expect((await call(w.owner, 'DELETE', `${w.path}/access/${target}`, undefined, url)).status).toBe(204); // idempotent
    });

    it('PUT converges the group to exactly ONE live row with the new role, and the authority to exactly that role (roles do not stack)', async () => {
      const w = await world(url);
      const target = newUser('ag-t');
      await plantPair(w, target, uuidRole, typeRole);
      const res = await call(w.owner, 'PUT', `${w.path}/access/${target}`, { role: 'list-translator' }, url);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ list_id: w.list.id, user_id: target, role: 'list-translator' });
      const live = await liveAccessRowsOf(w.list.id, target);
      expect(live.map((r) => r.role)).toEqual(['list-translator']); // one logical grant, one row
      expect((await accessRowsOf(w.list.id, target)).length).toBeGreaterThanOrEqual(1);
      expect(await authorityRoles(w, target)).toEqual(['list-translator']);
      const roster = (await walkRoster(w, 50)).filter((g) => canonicalUuid(g.user_id) === canonicalUuid(target));
      expect(roster).toEqual([expect.objectContaining({ user_id: target, role: 'list-translator' })]);
      // idempotent: the same PUT again changes nothing
      expect((await call(w.owner, 'PUT', `${w.path}/access/${target}`, { role: 'list-translator' }, url)).status).toBe(200);
      expect((await liveAccessRowsOf(w.list.id, target)).map((r) => r.role)).toEqual(['list-translator']);
      expect(await authorityRoles(w, target)).toEqual(['list-translator']);
    });
  });

  describe('the last-owner guard sees a user\'s rows as ONE owner', () => {
    it('a sole owner stored under BOTH renderings can be neither demoted nor removed (409), and nothing changes', async () => {
      const w = await world(url);
      const sole = w.owner.userId;
      const [existing] = await accessRowsOf(w.list.id, sole);
      expect(existing?.role).toBe('list-owner'); // fixture sanity: the creator's own owner row
      // legacy: the same owner also has a row under the OTHER rendering
      const [typeUser, uuidUser] = userForms(sole);
      const [typeOrg, uuidOrg] = orgForms(w.org);
      const other = existing!.user_id === uuidUser ? typeUser : uuidUser;
      await plantAccessRow({ listId: w.list.id, storedUser: other, storedOrg: other === uuidUser ? uuidOrg : typeOrg, role: 'list-owner', grantedBy: other, grantedAt: new Date('2025-12-31T00:00:00Z') });
      expect((await liveAccessRowsOf(w.list.id, sole)).length).toBe(2);

      expectError(await call(w.owner, 'DELETE', `${w.path}/access/${sole}`, undefined, url), 409, 'CONFLICT');
      expectError(await call(w.owner, 'PUT', `${w.path}/access/${sole}`, { role: 'list-viewer' }, url), 409, 'CONFLICT');
      expect((await liveAccessRowsOf(w.list.id, sole)).map((r) => r.role)).toEqual(['list-owner', 'list-owner']); // untouched
      expect(await authorityRoles(w, sole)).toEqual(['list-owner']);
    });

    it('a user is an owner when ANY of its rows is: the sole owner whose survivor row says viewer still cannot be demoted or removed; with a second owner both work', async () => {
      const w = await world(url);
      const t = newUser('ag-sole');
      // t: bare-UUID row viewer (the survivor), TypeID row owner. The creator is still the other owner.
      await plantPair(w, t, 'list-viewer', 'list-owner');
      const asT = asUser(t, w.org);
      // the creator hands over: removing the creator is allowed because t is a confirmed OTHER owner (its TypeID row is an owner)
      expect((await call(asT, 'DELETE', `${w.path}/access/${w.owner.userId}`, undefined, url)).status).toBe(204);
      // now t is the sole owner; its survivor says viewer, its other row says owner
      expectError(await call(asT, 'DELETE', `${w.path}/access/${t}`, undefined, url), 409, 'CONFLICT');
      expectError(await call(asT, 'PUT', `${w.path}/access/${t}`, { role: 'list-editor' }, url), 409, 'CONFLICT');
      expect((await liveAccessRowsOf(w.list.id, t)).length).toBe(2);
      // control: a second owner makes the same requests legal
      const second = newUser('ag-second');
      expect((await call(asT, 'PUT', `${w.path}/access/${second}`, { role: 'list-owner' }, url)).status).toBe(200);
      expect((await call(asT, 'DELETE', `${w.path}/access/${t}`, undefined, url)).status).toBe(204);
      expect(await liveAccessRowsOf(w.list.id, t)).toHaveLength(0);
      expect(await authorityRoles(w, t)).toEqual([]);
    });
  });

  it('a paged walk of the roster visits every logical user exactly once and terminates, for every page size', async () => {
    const w = await world(url);
    const [t1, t2, t3, t4] = [newUser('ag-w'), newUser('ag-w'), newUser('ag-w'), newUser('ag-w')];
    await plantPair(w, t1, 'list-viewer', 'list-editor');
    await plantPair(w, t2, 'list-contributor', 'list-viewer');
    // singles under each rendering, and one made by the API itself
    const [, uuid3] = userForms(t3);
    const [, uuidOrg] = orgForms(w.org);
    await plantAccessRow({ listId: w.list.id, storedUser: uuid3, storedOrg: uuidOrg, role: 'list-viewer', grantedBy: uuid3, grantedAt: new Date('2026-01-03T00:00:00Z') });
    await fixtureGrant(w.org, t3, w.list.id, 'list-viewer');
    expect((await call(w.owner, 'PUT', `${w.path}/access/${t4}`, { role: 'list-editor' }, url)).status).toBe(200);
    const expected = [w.owner.userId, t1, t2, t3, t4].map(canonicalUuid).sort();
    for (const limit of [1, 2, 3, 50, 200]) {
      const roster = await walkRoster(w, limit);
      expect({ limit, users: roster.map((g) => canonicalUuid(g.user_id)).sort() }).toEqual({ limit, users: expected });
    }
    // the survivor's role is what the roster reports for a pair
    const roster = await walkRoster(w, 2);
    expect(roster.find((g) => canonicalUuid(g.user_id) === canonicalUuid(t1))?.role).toBe('list-viewer');
    expect(roster.find((g) => canonicalUuid(g.user_id) === canonicalUuid(t2))?.role).toBe('list-contributor');
  });
});

describe('the ORG id is one group too: a manager whose token carries the OTHER rendering of the list\'s org', () => {
  it('flag ON: reads, grants and revokes access on a list stored under the org\'s TypeID; flag OFF: the 4.0.0 exact scope hides the list (404)', async () => {
    for (const [label, url] of INSTANCES) {
      const w = await world(url); // the list is stored under the TypeID (the owner's claim)
      const manager = newUser('ag-mgr');
      await fixtureGrant(w.org, manager, w.list.id, 'list-owner'); // the operator path: a manager role on THIS instance
      const [, uuidOrg] = orgForms(w.org);
      const viaUuid = asUser(manager, uuidOrg);
      const target = newUser('ag-mt');
      if (url === undefined) {
        const roster = await call(viaUuid, 'GET', `${w.path}/access`, undefined, url);
        expect({ label, status: roster.status }).toEqual({ label, status: 200 });
        expect(roster.body.items.map((g: { user_id: string }) => canonicalUuid(g.user_id))).toContain(canonicalUuid(w.owner.userId));
        expect((await call(viaUuid, 'PUT', `${w.path}/access/${target}`, { role: 'list-viewer' }, url)).status).toBe(200);
        expect((await liveAccessRowsOf(w.list.id, target)).map((r) => r.role)).toEqual(['list-viewer']);
        expect((await call(viaUuid, 'DELETE', `${w.path}/access/${target}`, undefined, url)).status).toBe(204);
        expect(await liveAccessRowsOf(w.list.id, target)).toHaveLength(0);
      } else {
        expectError(await call(viaUuid, 'GET', `${w.path}/access`, undefined, url), 404, 'NOT_FOUND');
        expectError(await call(viaUuid, 'PUT', `${w.path}/access/${target}`, { role: 'list-viewer' }, url), 404, 'NOT_FOUND');
        expect(await accessRowsOf(w.list.id, target)).toHaveLength(0);
      }
    }
  });

  it('control: another org\'s manager never reaches the list through either rendering (an id is not a capability)', async () => {
    const w = await world(undefined);
    const stranger = newOrg('ag-str');
    const [, strangerUuid] = orgForms(stranger);
    for (const claim of [stranger, strangerUuid]) {
      const them = actor('ag-x', claim, 'admin');
      await fixtureGrant(claim, them.userId, w.list.id, 'list-owner'); // even a role in THEIR tenant on this list id grants nothing in ours
      expectError(await call(them, 'GET', `${w.path}/access`), 404, 'NOT_FOUND');
    }
  });
});
