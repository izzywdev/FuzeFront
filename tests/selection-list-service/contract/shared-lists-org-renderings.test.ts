/**
 * One organization, two renderings (SL9, service 1.1.x hardening: "canonical org-id handling").
 * The token's org claim may be an organization's `org_…` TypeID or its bare UUID (production mints the bare UUID; the
 * service accepts either — see helpers/auth.ts), so every place that compares, stores or keys by organization must treat
 * the two as the SAME organization. Written against the frozen contract (an org is identified by its OrganizationId;
 * `key` is "unique within the organization"; a fork is idempotent "per (organization, source)") and the design record
 * (D2: a `platform` list is owned by THE platform organization; D6: one fork per (org, source)). Needs the shared-lists
 * flag ON (helpers/shared-lists.ts); the stand-in Security API treats the two renderings as one tenant.
 *
 * Pinned:
 *   1. a common list published by an operator whose token carries the OTHER rendering of the platform org is stored under
 *      the CONFIGURED platform org id (what the response reports and what the row holds), and a second publish of the
 *      same key in EITHER rendering is `409 CONFLICT` (key uniqueness per organization is not bypassed by switching
 *      rendering), leaving exactly one row;
 *   2. fork idempotency holds across renderings: the repeat fork by the same organization — TypeID claim first and UUID
 *      claim second, or the reverse — is `200` with the existing fork, never a second copy or a `409 fork_exists`;
 *      the key lookup then names that fork for either rendering.
 */
import {
  actor, call, createPlatformList, effectiveList, forkList, newCodecOrg, orgUuidOf, PLATFORM_ORG_ID, rnd, assertSharedListsOn, expectError,
  walkItems,
} from '../helpers/shared-lists';
import { closeDb, dbQuery } from '../helpers/db';

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

const rows = (key: string) => dbQuery<{ id: string; organization_id: string }>('SELECT id, organization_id FROM selection_lists WHERE key = $1', [key]);

describe('1. publishing a common list through either rendering of the platform org', () => {
  const platUuid = orgUuidOf(PLATFORM_ORG_ID);

  it.each([
    ['UUID claim first, then TypeID, then UUID again', platUuid, PLATFORM_ORG_ID],
    ['TypeID claim first, then UUID', PLATFORM_ORG_ID, platUuid],
  ] as const)('%s: stored under the configured id; every later publish of the key is 409 and creates nothing', async (_n, firstClaim, secondClaim) => {
    const key = `rend-${rnd()}-${rnd()}`;
    const first = await call(actor('op1', firstClaim, 'admin'), 'POST', '/v1/selection-lists', { key, name: 'Rendered common', visibility: 'platform' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ visibility: 'platform', organization_id: PLATFORM_ORG_ID }); // the CONFIGURED id, whatever the claim
    expect(await rows(key)).toEqual([{ id: first.body.id, organization_id: PLATFORM_ORG_ID }]);

    for (const claim of [secondClaim, firstClaim]) {
      const again = await call(actor('op2', claim, 'admin'), 'POST', '/v1/selection-lists', { key, name: 'Duplicate', visibility: 'platform' });
      expectError(again, 409, 'CONFLICT', null);
    }
    expect(await rows(key)).toHaveLength(1);

    // control: a different key publishes fine through the same two claims (so the 409s are about the key)
    for (const claim of [firstClaim, secondClaim]) {
      const other = await call(actor('op3', claim, 'admin'), 'POST', '/v1/selection-lists', { key: `rend-${rnd()}-${rnd()}`, name: 'Another', visibility: 'platform' });
      expect(other.status).toBe(201);
      expect(other.body.organization_id).toBe(PLATFORM_ORG_ID);
    }
  });

  it('the common list is the SAME list to a reader whichever rendering their own org uses, and an operator on the other rendering keeps operating it', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const reader = newCodecOrg();
    for (const claim of [reader.wire, reader.uuid]) {
      const got = await call(actor('rd', claim, 'viewer'), 'GET', `/v1/selection-lists/${p.list.id}`);
      expect(got.status).toBe(200);
      expect(got.body.organization_id).toBe(PLATFORM_ORG_ID);
    }
    // an operator acting through the UUID rendering is "in the platform org": it can publish (above) and read its common list
    expect((await call(actor('opu', platUuid, 'admin'), 'GET', `/v1/selection-lists/${p.list.id}`)).status).toBe(200);
  });
});

describe('2. fork idempotency across renderings of the forking organization', () => {
  it.each([
    ['TypeID first', 'wire', 'uuid'],
    ['UUID first', 'uuid', 'wire'],
  ] as const)('%s: the repeat fork through the other rendering is 200 with the existing fork (no second copy, no fork_exists)', async (_n, first, second) => {
    const org = newCodecOrg();
    const p = await createPlatformList({ itemCodes: ['A', 'B'] });
    const a1 = actor('a1', org[first], 'admin');
    const a2 = actor('a2', org[second], 'editor'); // holds create; reads the org-visible fork through the shared read
    const made = await forkList(a1, p.list.id);
    expect(made.status).toBe(201);
    const again = await forkList(a2, p.list.id);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(made.body.id);
    expect(again.body.forked_from).toEqual(made.body.forked_from);
    expect((await walkItems(a1, made.body.id, 'all')).length).toBe(2); // nothing copied twice
    expect(await rows(p.list.key)).toHaveLength(1 + 1); // the common list + exactly one fork

    // the key lookup names that fork for both renderings, and the common list is shadowed for both
    for (const claim of [org.wire, org.uuid]) {
      expect((await effectiveList(actor('rd', claim, 'viewer'), p.list.key))?.id).toBe(made.body.id);
    }
  });
});
