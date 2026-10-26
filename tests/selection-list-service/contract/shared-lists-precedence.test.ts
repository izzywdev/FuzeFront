/**
 * Which list a key means — the precedence rule (SL9, D8) — via
 * `GET /v1/selection-lists?key=K&include_shared=true` (the client's `getEffectiveList(K)`).
 * Written against the FROZEN contract (openapi.yaml 4.1.0, "Which list a key means (precedence)" and the
 * `key` / `include_shared` parameters) and docs/planning/selection-lists-shared-and-fork.md. Needs the
 * shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Design-record rows pinned:
 *   §11.4 / D8   effective list for key K, caller C in org X:
 *                  1. X's own ACTIVE list with key K that C can read (instance grant or `org` visibility) —
 *                     normally X's fork;
 *                  2. else the ACTIVE `platform` list with key K;
 *                  3. else nothing.
 *                An archived fork falls through to the common list; a `private` fork shadows ONLY for those who
 *                can read it (grant-holders); without `include_shared` the 4.0.0 semantics apply unchanged.
 *                The page holds at most one row.
 *   D6           a fork keeps the source's key, so forking shadows the common list for the forking org and
 *                archiving the fork reverts to it.
 */
import {
  actor, call, createList, createPlatformList, effectiveList, forkList, L, newOrg, rnd, assertSharedListsOn,
  PLATFORM_ORG_ID,
} from '../helpers/shared-lists';
import { assertResponse } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const ORG_Q = newOrg('prcq');
const ORG_R = newOrg('prcr');
const admin = actor('adm', ORG_Q, 'admin');
const member = actor('mem', ORG_Q, 'viewer');
const otherOrgMember = actor('oth', ORG_R, 'viewer');

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

const key = (): string => `prec-${rnd()}-${rnd()}`;

describe('§11.4: common list -> fork -> archived fork, for one key', () => {
  it('with no own list the effective list is the common one (and the 4.0.0 key lookup finds nothing)', async () => {
    const k = key();
    const p = await createPlatformList({ key: k });
    const eff = await effectiveList(member, k);
    expect(eff).toMatchObject({ id: p.list.id, organization_id: PLATFORM_ORG_ID, visibility: 'platform' });
    // R7 control: without include_shared the lookup is the 4.0.0 one — a member with no grant finds nothing
    const legacy = await call(member, 'GET', `/v1/selection-lists?key=${k}`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.items).toEqual([]);
  });

  it('after the org forks, the fork is effective for its members and the common list for everyone else; archiving the fork reverts', async () => {
    const k = key();
    const p = await createPlatformList({ key: k });
    const fork = await forkList(admin, p.list.id);
    expect(fork.status).toBe(201);
    expect(fork.body.key).toBe(k);

    // an `org`-visible fork is the org's version for EVERY member (here: a plain viewer with no grant)
    expect(await effectiveList(member, k)).toMatchObject({ id: fork.body.id, organization_id: ORG_Q });
    expect(await effectiveList(admin, k)).toMatchObject({ id: fork.body.id });
    // another org is untouched (control: shadowing is per org)
    expect(await effectiveList(otherOrgMember, k)).toMatchObject({ id: p.list.id });

    // archive the fork -> falls through to the common list, for the owner and for members
    expect((await call(admin, 'POST', `${L(fork.body.id)}/archive`)).status).toBe(200);
    expect(await effectiveList(member, k)).toMatchObject({ id: p.list.id });
    expect(await effectiveList(admin, k)).toMatchObject({ id: p.list.id });

    // reactivate -> the fork again
    expect((await call(admin, 'PATCH', L(fork.body.id), { status: 'active' })).status).toBe(200);
    expect(await effectiveList(member, k)).toMatchObject({ id: fork.body.id });
  });

  it('the page is the standard envelope holding at most one row, and conforms to the spec', async () => {
    const k = key();
    await createPlatformList({ key: k });
    const res = await call(member, 'GET', `/v1/selection-lists?key=${k}&include_shared=true`);
    expect(res.status).toBe(200);
    assertResponse('GET', '/v1/selection-lists', 200, res.body);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.page).toMatchObject({ nextCursor: null, hasMore: false });
  });
});

describe('§11.4: a private fork shadows only for those who can read it', () => {
  it('a `private` fork is the owner\'s draft: members still get the common list; once shared (org) they get the fork', async () => {
    const k = key();
    const p = await createPlatformList({ key: k });
    const draft = await forkList(admin, p.list.id, { visibility: 'private' });
    expect(draft.status).toBe(201);
    expect(draft.body.visibility).toBe('private');

    expect(await effectiveList(admin, k)).toMatchObject({ id: draft.body.id }); // the grant-holder (owner) sees its draft
    expect(await effectiveList(member, k)).toMatchObject({ id: p.list.id }); // nobody else is shadowed by a draft

    // a grant makes the draft readable for that user, hence effective for them
    const granted = actor('grt', ORG_Q, 'viewer');
    expect((await call(admin, 'PUT', `${L(draft.body.id)}/access/${granted.userId}`, { role: 'list-viewer' })).status).toBe(200);
    expect(await effectiveList(granted, k)).toMatchObject({ id: draft.body.id });
    expect(await effectiveList(member, k)).toMatchObject({ id: p.list.id });

    // publishing the draft to the org (private -> org) flips the members over
    expect((await call(admin, 'PATCH', L(draft.body.id), { visibility: 'org' })).status).toBe(200);
    expect(await effectiveList(member, k)).toMatchObject({ id: draft.body.id });
  });
});

describe('§11.4: own readable active list > common list (a non-fork list with the same key also wins)', () => {
  it('an own `org` list with the key shadows the common list for the org\'s members; a `private` one only for its grant-holders', async () => {
    const k = key();
    const p = await createPlatformList({ key: k });
    const own = await createList(admin, { key: k, name: 'Own org version', visibility: 'org' });
    expect(await effectiveList(member, k)).toMatchObject({ id: own.id, organization_id: ORG_Q });
    expect(await effectiveList(otherOrgMember, k)).toMatchObject({ id: p.list.id });

    const k2 = key();
    const p2 = await createPlatformList({ key: k2 });
    const ownPrivate = await createList(admin, { key: k2, name: 'Own private version' });
    expect(await effectiveList(admin, k2)).toMatchObject({ id: ownPrivate.id });
    expect(await effectiveList(member, k2)).toMatchObject({ id: p2.list.id });
  });

  it('an own ARCHIVED list does not shadow (only active lists participate)', async () => {
    const k = key();
    const p = await createPlatformList({ key: k });
    const own = await createList(admin, { key: k, name: 'Retired own version', visibility: 'org' });
    expect((await call(admin, 'POST', `${L(own.id)}/archive`)).status).toBe(200);
    expect(await effectiveList(member, k)).toMatchObject({ id: p.list.id });
  });
});

describe('§11.4: nothing to find', () => {
  it('an unknown key, or a key held only by an ARCHIVED common list, yields an empty page', async () => {
    expect((await call(member, 'GET', `/v1/selection-lists?key=nope-${rnd()}&include_shared=true`)).body.items).toEqual([]);
    const k = key();
    const p = await createPlatformList({ key: k });
    expect(await effectiveList(member, k)).toMatchObject({ id: p.list.id }); // control: it is found while active
    expect((await call(p.owner, 'POST', `${L(p.list.id)}/archive`)).status).toBe(200);
    expect(await effectiveList(member, k)).toBeUndefined();
  });

  it('another customer org\'s list with the key never leaks into the lookup', async () => {
    const k = key();
    const theirs = await createList(actor('thr', ORG_R, 'admin'), { key: k, name: 'Theirs', visibility: 'org' });
    expect(await effectiveList(member, k)).toBeUndefined();
    expect(await effectiveList(otherOrgMember, k)).toMatchObject({ id: theirs.id }); // control: its own org finds it
  });
});
