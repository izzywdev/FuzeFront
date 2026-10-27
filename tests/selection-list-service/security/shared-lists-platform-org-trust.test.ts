/**
 * Who counts as THE platform organization (SL9, service 1.1.0 security hardening of design record D2 / D5 / §12).
 * Written against the frozen contract (openapi.yaml 4.1.0: a `platform` list is "owned by the platform
 * organization"; `publish_platform` "only effective in the platform organization's tenant") and the design record's
 * fail-closed rule: "if neither resolves, every platform feature fails closed (no `platform` lists are served or
 * created, nothing else changes)". Needs the shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Rules pinned (and why): the platform org id is CONFIGURATION ONLY (`SELECTION_LIST_PLATFORM_ORG_ID`); the org
 * projection (`selection_list_ref_index`) can only CONFIRM it - an ACTIVE row, `is_active = true`, `org_type =
 * 'platform'` - and is never a source: its `org_type` is user-influenced data, so inferring "the platform org" from
 * it would let anyone who can get an org typed `platform` publish into every tenant.
 *   1. Decoy: an org the projection types `platform` that is NOT the configured id gets nothing - it cannot publish or
 *      promote (even where the stand-in Security API says yes), and a `platform` row it owns is untrusted data: not
 *      readable, not listed, not resolvable, not forkable.
 *   2. Disabled states (one extra service instance each, same database, flag ON):
 *        unset        - no SELECTION_LIST_PLATFORM_ORG_ID at all, although the projection types the real platform org;
 *        unconfirmed  - configured, but the projection has no row for it;
 *        deactivated  - configured and typed `platform`, but `is_active = false`.
 *      In each, common lists are not served (read / list / key lookup / resolve / fork / mutate answer as for a list that
 *      does not exist) and nobody can publish or promote - while the rest of the feature (`org` lists) works, so the
 *      instance is demonstrably running it. Where a projection row can confirm the org, doing so flips the SAME requests
 *      to served/allowed (positive control: the gate really is the projection, not a vacuous deny).
 *
 * HOW THE HARNESS RUNS THIS: SHARED_LISTS_PLATFORM_DISABLED_URLS="unset=<url>,unconfirmed=<url>,deactivated=<url>" -
 * three service instances on the same database as the main one, differing only in SELECTION_LIST_PLATFORM_ORG_ID:
 * unset / UNCONFIRMED_PLATFORM_ORG_ID / DEACTIVATED_PLATFORM_ORG_ID (helpers/sl9-constants.ts). A missing
 * entry fails the suite with an explicit PRECONDITION message (never a skip).
 */
import {
  actor, call, createList, expectError, forkList, insertPlatformRowViaSql, L, newOrg, permitPublishAnywhere, PLATFORM_ORG_ID, rnd,
  assertSharedListsOn, walkLists, type Actor,
} from '../helpers/shared-lists';
import { DEACTIVATED_PLATFORM_ORG_ID, DECOY_PLATFORM_ORG_ID, UNCONFIRMED_PLATFORM_ORG_ID } from '../helpers/sl9-constants';
import { closeDb, dbQuery } from '../helpers/db';
import { canonicalUuid } from '../helpers/ids';

const ORG_Y = newOrg('trty');
const reader = actor('rd', ORG_Y, 'viewer');
const yAdmin = actor('ya', ORG_Y, 'admin');

afterAll(async () => {
  await closeDb();
});

const keyCount = async (key: string): Promise<number> => (await dbQuery('SELECT 1 FROM selection_lists WHERE key = $1', [key])).length;
const ids = (rows: Array<{ id: string }>): string[] => rows.map((r) => r.id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const t0 = Date.now();
  let last = await fn();
  while (!ok(last) && Date.now() - t0 < timeoutMs) {
    await sleep(500);
    last = await fn();
  }
  return last;
}

describe('1. a decoy: typed `platform` by the projection but NOT the configured platform org', () => {
  const decoyAdmin = actor('dca', DECOY_PLATFORM_ORG_ID, 'admin');

  beforeAll(async () => {
    await assertSharedListsOn();
    await permitPublishAnywhere(DECOY_PLATFORM_ORG_ID); // Permit would say yes in its own tenant: only the SERVICE can refuse
    const typed = await dbQuery(`SELECT org_type, is_active, status FROM selection_list_ref_index WHERE wire_id = $1`, [DECOY_PLATFORM_ORG_ID]);
    expect(typed).toEqual([{ org_type: 'platform', is_active: true, status: 'active' }]); // fixture sanity: the decoy IS projected as a platform org
  });

  it('cannot publish a common list, nor promote its own list to platform: 403 and nothing changes', async () => {
    const key = `decoy-${rnd()}-${rnd()}`;
    expectError(await call(decoyAdmin, 'POST', '/v1/selection-lists', { key, name: 'Decoy common', visibility: 'platform' }), 403, 'FORBIDDEN');
    expect(await keyCount(key)).toBe(0);
    const own = await createList(decoyAdmin, { name: 'Decoy org list', visibility: 'org' });
    expectError(await call(decoyAdmin, 'PATCH', L(own.id), { visibility: 'platform' }), 403, 'FORBIDDEN');
    expect((await call(decoyAdmin, 'GET', L(own.id))).body.visibility).toBe('org');
    // control: the genuine platform org's operator publishes through the very same route
    const op = actor('op', PLATFORM_ORG_ID, 'admin');
    expect((await call(op, 'POST', '/v1/selection-lists', { key: `real-${rnd()}-${rnd()}`, name: 'Real common', visibility: 'platform' })).status).toBe(201);
  });

  it('a `platform` row owned by the decoy is untrusted data: not readable, listed, resolvable or forkable by anyone', async () => {
    const planted = await insertPlatformRowViaSql(DECOY_PLATFORM_ORG_ID);
    expectError(await call(reader, 'GET', L(planted.id)), 404, 'NOT_FOUND');
    expectError(await call(reader, 'GET', `${L(planted.id)}/items`), 404, 'NOT_FOUND');
    for (const qs of ['include_shared=true', 'include_shared=true&visibility=platform']) {
      expect(ids((await walkLists(reader, qs)).rows)).not.toContain(planted.id);
    }
    expect((await call(reader, 'GET', `/v1/selection-lists?key=${planted.key}&include_shared=true`)).body.items).toEqual([]);
    const resolved = await call(reader, 'POST', '/v1/resolve', { ids: [planted.itemId] });
    expect(resolved.body).toEqual({ results: {}, missing: [planted.itemId] });
    expectError(await forkList(yAdmin, planted.id), 404, 'NOT_FOUND');
    expectError(await call(yAdmin, 'PATCH', L(planted.id), { name: 'x' }), 404, 'NOT_FOUND');

    // control: the IDENTICAL planted shape owned by the configured platform org IS served - so the denials above are about the owner
    const genuine = await insertPlatformRowViaSql(PLATFORM_ORG_ID);
    expect((await call(reader, 'GET', L(genuine.id))).status).toBe(200);
    expect(ids((await walkLists(reader, 'include_shared=true')).rows)).toContain(genuine.id);
    const ok = await call(reader, 'POST', '/v1/resolve', { ids: [genuine.itemId] });
    expect(Object.keys(ok.body.results)).toEqual([genuine.itemId]);
  });
});

type Scenario = {
  label: 'unset' | 'unconfirmed' | 'deactivated';
  /** the org the instance is configured with (null: unset) */
  configured: string | null;
  /** put the projection into the DISABLED state */
  reset: () => Promise<void>;
  /** make the projection confirm `configured` (null for `unset`: nothing can) */
  confirm: (() => Promise<void>) | null;
};

const SCENARIOS: Scenario[] = [
  { label: 'unset', configured: null, reset: async () => undefined, confirm: null },
  {
    label: 'unconfirmed',
    configured: UNCONFIRMED_PLATFORM_ORG_ID,
    reset: async () => void (await dbQuery(`DELETE FROM selection_list_ref_index WHERE wire_id = $1`, [UNCONFIRMED_PLATFORM_ORG_ID])),
    confirm: async () =>
      void (await dbQuery(
        `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, org_type, is_active, updated_at)
         VALUES ('organization', $2, 'active', $1, 'platform', true, NOW())
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET status = 'active', org_type = 'platform', is_active = true, updated_at = NOW()`,
        [UNCONFIRMED_PLATFORM_ORG_ID, canonicalUuid(UNCONFIRMED_PLATFORM_ORG_ID)],
      )),
  },
  {
    label: 'deactivated',
    configured: DEACTIVATED_PLATFORM_ORG_ID,
    reset: async () =>
      void (await dbQuery(
        `INSERT INTO selection_list_ref_index (entity_type, entity_id, status, wire_id, org_type, is_active, updated_at)
         VALUES ('organization', $2, 'active', $1, 'platform', false, NOW())
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET status = 'active', org_type = 'platform', is_active = false, updated_at = NOW()`,
        [DEACTIVATED_PLATFORM_ORG_ID, canonicalUuid(DEACTIVATED_PLATFORM_ORG_ID)],
      )),
    confirm: async () => void (await dbQuery(`UPDATE selection_list_ref_index SET is_active = true, updated_at = NOW() WHERE wire_id = $1`, [DEACTIVATED_PLATFORM_ORG_ID])),
  },
];

const configuredInstances = new Map(
  (process.env['SHARED_LISTS_PLATFORM_DISABLED_URLS'] ?? '')
    .split(',')
    .map((kv) => kv.trim())
    .filter(Boolean)
    .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)] as const),
);

describe('2. platform features are DISABLED (fail closed) until the projection confirms the configured org', () => {
  it('PRECONDITION: SHARED_LISTS_PLATFORM_DISABLED_URLS names an instance for every scenario (unset, unconfirmed, deactivated)', () => {
    const missing = SCENARIOS.filter((s) => !configuredInstances.get(s.label)).map((s) => s.label);
    if (missing.length > 0) {
      throw new Error(
        `PRECONDITION: no service instance configured for [${missing.join(', ')}]. Set SHARED_LISTS_PLATFORM_DISABLED_URLS="unset=<url>,unconfirmed=<url>,deactivated=<url>" ` +
          `(instances on the same database; SELECTION_LIST_PLATFORM_ORG_ID unset / ${UNCONFIRMED_PLATFORM_ORG_ID} / ${DEACTIVATED_PLATFORM_ORG_ID}) - see helpers/shared-lists.ts and this file's header.`,
      );
    }
  });

  describe.each(SCENARIOS.map((s) => [s.label, s] as const))('instance: platform org %s', (_label, sc) => {
    const url = configuredInstances.get(sc.label) as string;
    const owner = sc.configured ?? PLATFORM_ORG_ID; // the org that owns the common list (the genuine one when nothing is configured)
    const operator: Actor = actor('op', owner, 'admin');
    let planted: { id: string; key: string; itemId: string };

    beforeAll(async () => {
      if (!url) throw new Error(`PRECONDITION: no instance for ${sc.label}`);
      await assertSharedListsOn();
      await sc.reset();
      if (sc.configured) await permitPublishAnywhere(sc.configured); // the stand-in says yes; only the service can say no
      planted = await insertPlatformRowViaSql(owner);
    });

    it('serves NO common list: read, items, listing, key lookup, resolve, fork and mutation all answer as for a list that does not exist', async () => {
      expectError(await call(reader, 'GET', L(planted.id), undefined, url), 404, 'NOT_FOUND');
      expectError(await call(reader, 'GET', `${L(planted.id)}/items`, undefined, url), 404, 'NOT_FOUND');
      for (const qs of ['include_shared=true', 'include_shared=true&visibility=platform']) {
        expect(ids((await walkLists(reader, qs, 50, url)).rows)).not.toContain(planted.id);
      }
      expect((await call(reader, 'GET', `/v1/selection-lists?key=${planted.key}&include_shared=true`, undefined, url)).body.items).toEqual([]);
      expect((await call(reader, 'POST', '/v1/resolve', { ids: [planted.itemId] }, url)).body).toEqual({ results: {}, missing: [planted.itemId] });
      expectError(await forkList(yAdmin, planted.id, undefined, url), 404, 'NOT_FOUND'); // unreadable => 404, not a fork
      const mutated = await call(yAdmin, 'PATCH', L(planted.id), { name: 'x' }, url);
      expectError(mutated, 404, 'NOT_FOUND'); // not 409 fork_required: it is not even readable
      expect(mutated.body.reason).toBeUndefined();
    });

    it('nobody can publish or promote: 403 even for an admin of the configured org that the stand-in Security API allows', async () => {
      const key = `dis-${rnd()}-${rnd()}`;
      expectError(await call(operator, 'POST', '/v1/selection-lists', { key, name: 'Cannot publish', visibility: 'platform' }, url), 403, 'FORBIDDEN');
      expect(await keyCount(key)).toBe(0);
      const own = await createList(operator, { name: 'Org list of the would-be platform org', visibility: 'org' }, url);
      expectError(await call(operator, 'PATCH', L(own.id), { visibility: 'platform' }, url), 403, 'FORBIDDEN');
      expect((await call(operator, 'GET', L(own.id), undefined, url)).body.visibility).toBe('org');
    });

    it('control: the instance runs the rest of the feature - an `org` list is shared with its members', async () => {
      const orgList = await createList(yAdmin, { name: 'Shared inside ORG_Y', visibility: 'org' }, url);
      const got = await call(reader, 'GET', L(orgList.id), undefined, url);
      expect(got.status).toBe(200);
      expect(got.body.visibility).toBe('org');
      expect(ids((await walkLists(reader, 'include_shared=true', 50, url)).rows)).toContain(orgList.id);
    });

    if (sc.confirm) {
      it('confirming the org in the projection (active, is_active, type platform) flips the SAME requests to served / allowed', async () => {
        await sc.confirm!();
        const got = await until(
          () => call(reader, 'GET', L(planted.id), undefined, url),
          (r) => r.status === 200,
        ); // the negative resolution is cached for a few seconds
        expect(got.status).toBe(200);
        expect(got.body).toMatchObject({ visibility: 'platform', organization_id: owner });
        expect(ids((await walkLists(reader, 'include_shared=true', 50, url)).rows)).toContain(planted.id);
        const resolved = await call(reader, 'POST', '/v1/resolve', { ids: [planted.itemId] }, url);
        expect(Object.keys(resolved.body.results)).toEqual([planted.itemId]);
        const published = await call(operator, 'POST', '/v1/selection-lists', { key: `en-${rnd()}-${rnd()}`, name: 'Now publishable', visibility: 'platform' }, url);
        expect(published.status).toBe(201);
        expect((await forkList(yAdmin, planted.id, undefined, url)).status).toBe(201);
      }, 60_000);
    } else {
      it('control: the main instance (platform org configured and confirmed) serves the very same common list - the deny is the missing configuration', async () => {
        const mainGot = await call(reader, 'GET', L(planted.id));
        expect(mainGot.status).toBe(200);
        expect(mainGot.body).toMatchObject({ visibility: 'platform', organization_id: PLATFORM_ORG_ID });
        const published = await call(operator, 'POST', '/v1/selection-lists', { key: `en-${rnd()}-${rnd()}`, name: 'Publishable on main', visibility: 'platform' });
        expect(published.status).toBe(201);
      });
    }
  });
});
