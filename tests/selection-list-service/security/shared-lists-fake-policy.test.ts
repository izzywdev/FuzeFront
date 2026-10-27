/**
 * Harness self-check — the stand-in Security API evaluates the 4.1.0 catalog actions exactly as the
 * Permit schema (backend/src/permit/schema.ts) defines them (SL9, design record
 * docs/planning/selection-lists-shared-and-fork.md D3 / D5; test-plan task 11).
 *
 * Pins (design rows):
 *   D3  `SelectionListCatalog:read_shared` = tenant admin | editor | viewer, NOT developer; confers no
 *       `SelectionList:*` action.
 *   D5  `SelectionListCatalog:publish_platform` = tenant admin only, EFFECTIVE ONLY in the platform
 *       organization's tenant (declared with the /__fixture/platform-org hook); a customer-org admin
 *       asking about the platform tenant is not an admin there; `publish-anywhere` is the per-tenant
 *       bare-Permit switch used to prove the SERVICE refuses by itself.
 *
 * Why this exists: every deny assertion in the SL9 suites is only as good as the policy backend that
 * produced the deny. This suite makes that backend's behaviour a tested fact (positive control for each
 * deny) instead of an assumption. It talks to the stand-in directly, so it is GREEN independent of the
 * service implementation.
 */
import { mintTestToken } from '../helpers/auth';
import { declarePlatformOrg, FAKE_SECURITY_URL, newCodecOrg, newOrg, newUser, orgUuidOf, permitPublishAnywhere, PLATFORM_ORG_ID } from '../helpers/shared-lists';

type Role = 'admin' | 'editor' | 'viewer' | 'developer';

const check = async (userId: string, actingOrg: string, role: Role, tenant: string, resource: { type: string; key?: string }, action: string): Promise<boolean> => {
  const token = mintTestToken({ userId, organizationId: actingOrg, roles: [role] });
  const res = await fetch(`${FAKE_SECURITY_URL}/api/v1/security/authz/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject: userId, tenant, resource, action }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { allow: boolean }).allow;
};

const catalog = { type: 'SelectionListCatalog' };

beforeAll(async () => {
  await declarePlatformOrg();
});

describe('read_shared (D3): customer tenant roles hold it, developer does not', () => {
  const org = newOrg('fakeps');
  it.each<[Role, boolean]>([
    ['admin', true],
    ['editor', true],
    ['viewer', true],
    ['developer', false],
  ])('tenant %s -> read_shared %s in its own tenant', async (role, expected) => {
    const u = newUser('fk');
    expect(await check(u, org, role, org, catalog, 'read_shared')).toBe(expected);
    // positive control for the harness: the same caller's `list` decision follows the documented 3.0.0 table
    expect(await check(u, org, role, org, catalog, 'list')).toBe(role !== 'developer');
  });

  it('is a membership proof IN THE CALLER\'S OWN TENANT: asking about another tenant is denied', async () => {
    const u = newUser('fk');
    expect(await check(u, org, 'admin', org, catalog, 'read_shared')).toBe(true);
    expect(await check(u, org, 'admin', newOrg('other'), catalog, 'read_shared')).toBe(false);
  });

  it('confers NO SelectionList:* action — not even read on an instance', async () => {
    const u = newUser('fk');
    for (const action of ['read', 'add_value', 'update', 'delete', 'manage_access']) {
      expect(await check(u, org, 'admin', org, { type: 'SelectionList', key: 'front_sl_01sl9fakepolicy000000' }, action)).toBe(false);
    }
  });
});

describe('organization id renderings: the TypeID and the bare UUID of one org are ONE tenant (as in production)', () => {
  it('a UUID-claim token is a member of the TypeID tenant (and vice versa); a different org is not', async () => {
    const o = newCodecOrg();
    const other = newCodecOrg();
    const u = newUser('fk');
    expect(await check(u, o.uuid, 'admin', o.wire, catalog, 'read_shared')).toBe(true);
    expect(await check(u, o.wire, 'admin', o.uuid, catalog, 'read_shared')).toBe(true);
    expect(await check(u, o.uuid, 'admin', other.wire, catalog, 'read_shared')).toBe(false);
  });

  it('publish_platform is effective for the platform org in either rendering, and only for it', async () => {
    const u = newUser('fk');
    const uuid = orgUuidOf(PLATFORM_ORG_ID);
    expect(await check(u, uuid, 'admin', PLATFORM_ORG_ID, catalog, 'publish_platform')).toBe(true);
    expect(await check(u, PLATFORM_ORG_ID, 'admin', uuid, catalog, 'publish_platform')).toBe(true);
    expect(await check(u, uuid, 'editor', uuid, catalog, 'publish_platform')).toBe(false);
    const o = newCodecOrg();
    expect(await check(u, o.uuid, 'admin', o.uuid, catalog, 'publish_platform')).toBe(false);
  });
});

describe('publish_platform (D5): admin only, effective only in the platform org tenant', () => {
  it.each<[Role, boolean]>([
    ['admin', true],
    ['editor', false],
    ['viewer', false],
    ['developer', false],
  ])('platform-org tenant role %s acting in the platform org -> %s', async (role, expected) => {
    expect(await check(newUser('fk'), PLATFORM_ORG_ID, role, PLATFORM_ORG_ID, catalog, 'publish_platform')).toBe(expected);
  });

  it('a customer-org admin is denied: not effective in its own tenant, and not an admin of the platform tenant', async () => {
    const customer = newOrg('cust');
    const u = newUser('fk');
    // positive control: the same user holds create/read_shared in its own tenant, so the deny below is about publish_platform
    expect(await check(u, customer, 'admin', customer, catalog, 'create')).toBe(true);
    expect(await check(u, customer, 'admin', customer, catalog, 'publish_platform')).toBe(false);
    expect(await check(u, customer, 'admin', PLATFORM_ORG_ID, catalog, 'publish_platform')).toBe(false);
  });

  it('publish-anywhere switches ONE tenant to bare-Permit behaviour (admin holds it), leaving every other tenant strict', async () => {
    const lenient = newOrg('lenient');
    const strict = newOrg('strict');
    await permitPublishAnywhere(lenient);
    const u = newUser('fk');
    expect(await check(u, lenient, 'admin', lenient, catalog, 'publish_platform')).toBe(true);
    expect(await check(u, lenient, 'editor', lenient, catalog, 'publish_platform')).toBe(false); // still admin-only
    expect(await check(u, strict, 'admin', strict, catalog, 'publish_platform')).toBe(false);
  });
});
