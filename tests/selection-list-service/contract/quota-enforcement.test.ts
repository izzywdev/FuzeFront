/**
 * Contract tests — quota ENFORCEMENT beyond org_lists / list_items (review M-4)
 *
 * The contract says create is "Subject to the `org_lists` and `user_lists` quotas" and a list's
 * translation upsert is "Subject to the `list_locales` quota". Until M-4 `user_lists` and
 * `list_locales` were only REPORTED by GET /quota; archived rows also counted toward nothing, so
 * archive + create grew the tables without bound. This suite pins, against the running service:
 *
 *   - user_lists: the (N+1)th active list by one user in an org is 403 QUOTA_EXCEEDED scope user_lists;
 *     another user in the same org is unaffected; archiving frees the allowance; un-archiving into a
 *     full allowance is refused (no bypass).
 *   - list_locales: a new locale beyond the ceiling is 403 scope list_locales (source locale counts);
 *     updating an existing locale is never refused.
 *   - storage ceiling: archived rows count toward a HARD ceiling (active limit x 10 by default), so
 *     repeated archive + create is refused at the ceiling with the SAME wire shape
 *     (scope org_lists, limit = the ceiling), and purging frees space.
 *
 * The ceilings are per-org override rows seeded by helpers/global-setup.ts (the service's own
 * production mechanism), one org per concern so no other suite is affected.
 */

import { rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { QUOTA_USER_TEST_ORG_ID, QUOTA_STORAGE_TEST_ORG_ID } from '../helpers/global-setup';

const USER_A = 'usr_01test00000000qusera000000';
const USER_B = 'usr_01test00000000quserb000000';
const USER_S = 'usr_01test00000000storag000000';

const tokenFor = (userId: string, orgId: string) => () => mintTestToken({ userId, organizationId: orgId });
const rand = () => Math.random().toString(16).slice(2, 8);

type Resp = { status: number; body: any };
const call = (token: () => string, method: string, path: string, body?: unknown): Promise<Resp> =>
  rawFetch(path, { method, token: token(), body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<Resp>;

const createList = (token: () => string, tag: string) =>
  call(token, 'POST', '/v1/selection-lists', { key: `m4-${tag}-${rand()}`, name: `M4 ${tag}` });
const archive = (token: () => string, id: string) => call(token, 'POST', `/v1/selection-lists/${id}/archive`);
const purge = (token: () => string, id: string) => call(token, 'DELETE', `/v1/selection-lists/${id}?purge=true`);

describe('user_lists enforcement (create is subject to it)', () => {
  const a = tokenFor(USER_A, QUOTA_USER_TEST_ORG_ID);
  const b = tokenFor(USER_B, QUOTA_USER_TEST_ORG_ID);
  const created: Array<{ id: string; token: () => string }> = [];

  afterAll(async () => {
    for (const c of created) await purge(c.token, c.id);
  });

  it('refuses the third active list of one user (limit 2) with 403 QUOTA_EXCEEDED scope user_lists; another user is unaffected', async () => {
    const first = await createList(a, 'u1');
    const second = await createList(a, 'u2');
    expect([first.status, second.status]).toEqual([201, 201]);
    created.push({ id: first.body.id, token: a }, { id: second.body.id, token: a });

    const third = await createList(a, 'u3');
    expect(third.status).toBe(403);
    expect(third.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists', limit: 2, current: 2 });

    const other = await createList(b, 'b1');
    expect(other.status).toBe(201);
    created.push({ id: other.body.id, token: b });
  });

  it('GET /quota reports the same ceiling and usage that is enforced', async () => {
    const { status, body } = await call(a, 'GET', '/v1/selection-lists/quota');
    expect(status).toBe(200);
    const entry = body.quotas.find((q: { scope: string }) => q.scope === 'user_lists');
    expect(entry).toMatchObject({ limit: 2, current: 2 });
  });

  it('archiving frees the allowance; un-archiving into a full allowance is 403 (no bypass); freeing a slot lets it back', async () => {
    const [x, y] = created.filter((c) => c.token === a);
    expect((await archive(a, x.id)).status).toBe(200);
    const replacement = await createList(a, 'u4');
    expect(replacement.status).toBe(201); // 2 active again
    created.push({ id: replacement.body.id, token: a });

    const back = await call(a, 'PATCH', `/v1/selection-lists/${x.id}`, { status: 'active' });
    expect(back.status).toBe(403);
    expect(back.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists', limit: 2 });

    expect((await archive(a, replacement.body.id)).status).toBe(200);
    expect((await call(a, 'PATCH', `/v1/selection-lists/${x.id}`, { status: 'active' })).status).toBe(200);
    expect(y).toBeDefined();
  });
});

describe('list_locales enforcement (adding a locale is subject to it)', () => {
  const b = tokenFor(USER_B, QUOTA_USER_TEST_ORG_ID);
  let listId = '';

  beforeAll(async () => {
    const r = await createList(b, 'loc');
    expect(r.status).toBe(201);
    listId = r.body.id;
  });
  afterAll(async () => {
    if (listId) await purge(b, listId);
  });

  it('the source locale counts: with a ceiling of 2, one more locale is allowed and the next is 403 list_locales', async () => {
    const fr = await call(b, 'PUT', `/v1/selection-lists/${listId}/translations/fr`, { name: 'Pays' });
    expect(fr.status).toBe(200);

    const de = await call(b, 'PUT', `/v1/selection-lists/${listId}/translations/de`, { name: 'Laender' });
    expect(de.status).toBe(403);
    expect(de.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales', limit: 2, current: 2 });

    const stored = await call(b, 'GET', `/v1/selection-lists/${listId}/translations`);
    expect(stored.status).toBe(200);
    expect(stored.body.map((t: { locale: string }) => t.locale)).toEqual(['fr']);
  });

  it('updating a locale the list already has is never refused', async () => {
    const again = await call(b, 'PUT', `/v1/selection-lists/${listId}/translations/fr`, { name: 'Pays 2' });
    expect(again.status).toBe(200);
  });

  it('autofill into a new locale is refused too', async () => {
    const r = await call(b, 'POST', `/v1/selection-lists/${listId}/translations/es/autofill`, {});
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales' });
  });

  it('removing a locale frees the slot', async () => {
    expect((await call(b, 'DELETE', `/v1/selection-lists/${listId}/translations/fr`)).status).toBe(204);
    expect((await call(b, 'PUT', `/v1/selection-lists/${listId}/translations/de`, { name: 'Laender' })).status).toBe(200);
  });
});

describe('hard storage ceiling: archived rows count toward it', () => {
  const s = tokenFor(USER_S, QUOTA_STORAGE_TEST_ORG_ID);
  const ids: string[] = [];
  // org_lists = 1 active, service default factor 10 -> at most 10 STORED lists.
  const CEILING = 10;

  afterAll(async () => {
    for (const id of ids) await purge(s, id);
  });

  it('archive + create cannot grow the table past the ceiling (the ACTIVE count never moves), and says archived rows count', async () => {
    for (let i = 0; i < CEILING; i++) {
      const c = await createList(s, `st${i}`);
      expect(c.status).toBe(201);
      ids.push(c.body.id);
      expect((await archive(s, c.body.id)).status).toBe(200);
    }

    const refused = await createList(s, 'over');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', limit: CEILING, current: CEILING });
    expect(String(refused.body.message)).toMatch(/archived/i);
  });

  it('purging an archived list frees storage', async () => {
    const victim = ids.pop() as string;
    expect((await purge(s, victim)).status).toBe(204);
    const c = await createList(s, 'after-purge');
    expect(c.status).toBe(201);
    ids.push(c.body.id);
  });
});
