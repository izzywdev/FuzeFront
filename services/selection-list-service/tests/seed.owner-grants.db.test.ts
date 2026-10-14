// seed.owner-grants.db.test.ts - decision Q3 (docs/planning/selection-lists-events.md 13.0.5):
// the org owner (identity.org.created.ownerId) receives `list-owner` on every platform-seeded list.
//
// REAL: Postgres + the real migrations, the real org-created handler, seed library, outbox,
// reconciler, `grantListOwner` (machine-identity token -> Security API grant -> access mirror upsert).
// FAKE: only the Security API (a recording AuthzClient) and the flag client.

import type { Knex } from 'knex';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import type { AuthzClient } from '@fuzefront/auth';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { appRequest, allowSource, projectOrg } from './helpers/seedFixtures';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

import { handleOrgCreated } from '../src/events/org-created.handler';
import { RetryBudget } from '../src/events/retryBudget';
import { _setAuthzClientForTesting } from '../src/middleware/authz';
import { _setGrantTokenProviderForTesting } from '../src/lib/machineIdentity';
import { FLAGS, setFlagClient } from '../src/flags';
import { applySeedRequest, runReconcilerOnce, ReconcilerBackoff } from '../src/seed';
import { ownerGrantSkippedTotal, ownerGrantsTotal } from '../src/lib/metrics';

// ---- the fake Security API: records every grant, fails on demand ------------------------------
interface RecordedGrant {
  subject: string;
  tenant: string;
  role: string;
  resource?: { type: string; key: string };
  token: string;
}
const grants: RecordedGrant[] = [];
const security: { failAfter: number | null } = { failAfter: null };
const fakeSecurity: AuthzClient = {
  check: async () => ({ allow: true }),
  bulkCheck: async (checks: unknown[]) => checks.map(() => ({ allow: true })),
  grant: async (req: any, token?: string) => {
    if (security.failAfter !== null && grants.length >= security.failAfter) throw new Error('security api 503');
    grants.push({ subject: req.subject, tenant: req.tenant, role: req.role, resource: req.resource, token: String(token) });
    return { id: `${req.tenant}:${req.subject}:${req.role}`, subject: req.subject, tenant: req.tenant, role: req.role, resource: req.resource } as never;
  },
  revoke: async () => undefined,
  listGrants: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }) as never,
  setAttributes: async (req: any) => ({ subject: req.subject, attributes: req.attributes, updatedAt: 0 }) as never,
} as unknown as AuthzClient;

setFlagClient({ getBooleanValue: async (key: string) => key === FLAGS.SELECTION_LISTS_SERVICE || key === FLAGS.SELECTION_LISTS_SEED_DEFAULTS });

let n = 70;
const nextUuid = () => `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7f${String(++n).padStart(2, '0')}`;
const OWNER_UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b0aa1';
const OWNER_WIRE = fromUuid('user', OWNER_UUID);
const MACHINE_TOKEN = 'fake-machine-token';

const event = (uuid: string, over: Record<string, unknown> = {}, correlationId = 'corr-grants') => ({
  version: '1.0',
  topic: 'identity.org.created' as const,
  correlationId,
  occurredAt: '2026-10-04T00:00:00.000Z',
  payload: { organizationId: uuid, slug: `org-${uuid.slice(-4)}`, name: 'Acme', type: 'organization' as const, parentId: null, ownerId: OWNER_UUID, isActive: true, ...over },
});

const counterValue = async (c: typeof ownerGrantsTotal | typeof ownerGrantSkippedTotal, labels: Record<string, string>): Promise<number> => {
  const m = await c.get();
  return m.values.filter((v) => Object.entries(labels).every(([k, val]) => (v.labels as Record<string, string>)[k] === val)).reduce((a, v) => a + v.value, 0);
};

dbDescribe('org owner list-owner grants on seeded lists (real Postgres, recording Security API)', () => {
  let t: TestDb;
  let db: Knex;
  const wire = (uuid: string) => fromUuid('organization', uuid);
  const lists = (org: string) => db('selection_lists').where({ organization_id: org }).orderBy('key');
  const mirror = (org: string) =>
    db('selection_list_access as a').join('selection_lists as l', 'l.id', 'a.list_id').where('l.organization_id', org).select('a.*').orderBy('a.list_id');
  const grantAudit = (org: string) =>
    db('selection_list_audit as a').join('selection_lists as l', 'l.id', 'a.list_id').where({ 'l.organization_id': org, 'a.action': 'seed.owner-granted' }).select('a.*');

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
    _setAuthzClientForTesting(fakeSecurity);
    _setGrantTokenProviderForTesting({ getToken: async () => MACHINE_TOKEN });
    await allowSource(db, 'fuzecrm');
  });
  afterAll(async () => {
    _setGrantTokenProviderForTesting(null);
    setFlagClient(null);
    await t.drop();
  });
  beforeEach(() => {
    grants.length = 0;
    security.failAfter = null;
  });

  it('the org owner receives list-owner on EVERY seeded list (Security API grant + access mirror + audit row), via the machine identity', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    const result = await handleOrgCreated(event(uuid) as never);
    expect(result).toMatchObject({ seeding: 'attempted' });

    const ls = await lists(org);
    expect(ls).toHaveLength(3);

    // Security API: one grant per list, instance-scoped, for the owner's usr_ TypeID in the org's tenant.
    expect(grants).toHaveLength(3);
    for (const g of grants) {
      expect(g).toMatchObject({ subject: OWNER_WIRE, tenant: org, role: 'list-owner', token: MACHINE_TOKEN });
      expect(g.resource?.type).toBe('SelectionList');
    }
    expect(grants.map((g) => g.resource?.key).sort()).toEqual(ls.map((l: any) => l.id).sort());

    // Access mirror: one active list-owner row per list for the owner, granted_by the seed principal.
    const rows = await mirror(org);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toMatchObject({ user_id: OWNER_WIRE, role: 'list-owner', granted_by: 'system:selection-list-service', org_id: org, revoked_at: null });
    }

    // Seed trail: one audit row per grant, naming who got what.
    const audit = await grantAudit(org);
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ actor_id: 'system:selection-list-service', action: 'seed.owner-granted' });
    expect(audit[0].after).toMatchObject({ seedSource: 'platform', role: 'list-owner', userId: OWNER_WIRE });

    // The projection learned the owner as a usr_ TypeID.
    const proj = await db('selection_list_ref_index').where({ wire_id: org }).first();
    expect(proj.owner_id).toBe(OWNER_WIRE);
    expect(proj.org_name).toBe('Acme');
  });

  it('a REPLAY (already-applied seed) does not duplicate: no second Security API grant, no second mirror/audit row', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    await handleOrgCreated(event(uuid) as never);
    expect(grants).toHaveLength(3);

    const again = await handleOrgCreated(event(uuid) as never);
    expect(again).toMatchObject({ seeding: 'attempted' });
    expect(grants).toHaveLength(3); // unchanged
    expect(await mirror(org)).toHaveLength(3);
    expect(await grantAudit(org)).toHaveLength(3);
    expect(await lists(org)).toHaveLength(3);
  });

  it('a grant FAILURE throws (the consumer retries); the retry grants only what is missing and the seed is not redone', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    security.failAfter = 1; // the first grant succeeds, the second hits a 503
    const ev = event(uuid) as never;
    const budget = new RetryBudget(5);
    await expect(handleOrgCreated(ev, { budget })).rejects.toThrow('security api 503');

    // Seed committed (3 lists); exactly one grant landed, with its mirror + audit row; the rest did not.
    expect(await lists(org)).toHaveLength(3);
    expect(grants).toHaveLength(1);
    expect(await mirror(org)).toHaveLength(1);
    expect(await grantAudit(org)).toHaveLength(1);
    const ledgerBefore = await db('selection_list_seed_ledger').where({ organization_id: org });
    const failedBefore = await counterValue(ownerGrantsTotal, { result: 'failed' });
    expect(failedBefore).toBeGreaterThanOrEqual(1);

    // Security API recovers; the redelivered message completes the job.
    security.failAfter = null;
    const retry = await handleOrgCreated(ev, { budget });
    expect(retry).toMatchObject({ seeding: 'attempted' });
    expect(grants).toHaveLength(3); // 1 earlier + 2 now: never the first list twice
    expect(new Set(grants.map((g) => g.resource?.key)).size).toBe(3);
    expect(await mirror(org)).toHaveLength(3);
    expect(await grantAudit(org)).toHaveLength(3);
    expect(await db('selection_list_seed_ledger').where({ organization_id: org })).toEqual(ledgerBefore); // seed itself untouched
  });

  it('fails CLOSED when the machine identity is unavailable: the handler throws and no mirror row claims a grant', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    _setGrantTokenProviderForTesting({
      getToken: async () => {
        throw new Error('machine identity is not configured');
      },
    });
    try {
      await expect(handleOrgCreated(event(uuid) as never, { budget: new RetryBudget(5) })).rejects.toThrow('machine identity is not configured');
    } finally {
      _setGrantTokenProviderForTesting({ getToken: async () => MACHINE_TOKEN });
    }
    expect(grants).toHaveLength(0);
    expect(await mirror(org)).toHaveLength(0);
    expect(await lists(org)).toHaveLength(3); // the seed itself is not rolled back
  });

  it('a MISSING ownerId (null) skips the grant with a counter - seeding still succeeds, nothing throws', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    const before = await counterValue(ownerGrantSkippedTotal, { reason: 'no-owner' });
    const result = await handleOrgCreated(event(uuid, { ownerId: null }) as never);
    expect(result).toMatchObject({ seeding: 'attempted' });
    expect(await lists(org)).toHaveLength(3);
    expect(grants).toHaveLength(0);
    expect(await mirror(org)).toHaveLength(0);
    expect(await counterValue(ownerGrantSkippedTotal, { reason: 'no-owner' })).toBe(before + 1);
    expect((await db('selection_list_ref_index').where({ wire_id: org }).first()).owner_id).toBeNull();
  });

  it('a human decision survives: an owner whose grant was revoked / demoted is NOT re-granted by a replay', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    await handleOrgCreated(event(uuid) as never);
    const [first, second] = await lists(org);
    await db('selection_list_access').where({ list_id: first.id, user_id: OWNER_WIRE }).update({ revoked_at: new Date() });
    await db('selection_list_access').where({ list_id: second.id, user_id: OWNER_WIRE }).update({ role: 'list-viewer' });
    grants.length = 0;

    await handleOrgCreated(event(uuid) as never);
    expect(grants).toHaveLength(0);
    expect((await db('selection_list_access').where({ list_id: first.id, user_id: OWNER_WIRE }).first()).revoked_at).not.toBeNull();
    expect((await db('selection_list_access').where({ list_id: second.id, user_id: OWNER_WIRE }).first()).role).toBe('list-viewer');
  });

  it('an inactive org is projected but gets no seed and no grant', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    const result = await handleOrgCreated(event(uuid, { isActive: false }) as never);
    expect(result).toMatchObject({ seeding: 'skipped-inactive' });
    expect(grants).toHaveLength(0);
    expect(await lists(org)).toHaveLength(0);
  });

  it('app seed requests (seed.requested) get NO owner grant: the requesting app grants via the Security API', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    await projectOrg(db, org); // projected, owner unknown
    await db('selection_list_ref_index').where({ wire_id: org }).update({ owner_id: OWNER_WIRE });
    const result = await applySeedRequest(db, appRequest(org));
    expect(result).toMatchObject({ status: 'completed' });
    expect(await lists(org)).toHaveLength(1);
    expect(grants).toHaveLength(0);
    expect(await mirror(org)).toHaveLength(0);
  });

  it('the RECONCILER heals an org whose grant never landed (seeded earlier / grant failed): it is a candidate again and gets granted once', async () => {
    const uuid = nextUuid();
    const org = wire(uuid);
    security.failAfter = 0; // every grant fails
    await expect(handleOrgCreated(event(uuid) as never, { budget: new RetryBudget(5) })).rejects.toThrow('security api 503');
    expect(await lists(org)).toHaveLength(3);
    expect(await mirror(org)).toHaveLength(0);
    security.failAfter = null;

    const summary = await runReconcilerOnce(db, {
      isSeedingEnabled: async () => true,
      backoff: new ReconcilerBackoff(1, 1),
      batchDelayMs: 0,
      sleep: async () => undefined,
    });
    expect(summary.failed).toBe(0);
    expect(grants.filter((g) => g.tenant === org)).toHaveLength(3);
    expect(await mirror(org)).toHaveLength(3);

    // ... and once healed it is no longer a candidate: a second sweep grants nothing.
    const before = grants.length;
    await runReconcilerOnce(db, { isSeedingEnabled: async () => true, backoff: new ReconcilerBackoff(1, 1), batchDelayMs: 0, sleep: async () => undefined });
    expect(grants.length).toBe(before);
  });
});
