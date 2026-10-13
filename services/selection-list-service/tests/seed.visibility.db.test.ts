// seed.visibility.db.test.ts — seeding honours seed-list `visibility` (design record D12, task 9) against
// REAL Postgres with the real migrations, the real seed library, outbox and emitters.
//
// Rules pinned: flag OFF => visibility ignored, every list private (4.0.0); flag ON => `org` seeds a list every
// member can read, `platform` (platform packs only) is seeded ONCE into the platform org and SKIPPED for every
// other org; an app can never seed `platform`; platform org unresolved => platform lists are seeded nowhere;
// a legacy per-org copy of a list the pack now declares common is left alone (not archived as "dropped");
// visibility is applied at creation only; ledger semantics (keyed/hashed on the requested content) unchanged.

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { allowSource, appRequest, eventsAfter, FUZECRM_SUBJECT, maxSeq, orgId, projectOrg, spec } from './helpers/seedFixtures';
import { handleSeedRequested } from '../src/events/seed-requested.handler';
import { RetryBudget } from '../src/events/retryBudget';
import { applyPlatformDefaults, applySeedRequest, type SeedApplyRequest, type SeedCompleted, type SeedFailed } from '../src/seed';
import { setFlagClient } from '../src/flags';
import { flagClientWith } from './helpers/flagClient';
import { _resetPlatformOrgCacheForTesting, PLATFORM_ORG_ENV } from '../src/lib/sharedLists';

const completed = (r: unknown): SeedCompleted => {
  expect((r as any).status).toBe('completed');
  return r as SeedCompleted;
};
const failed = (r: unknown): SeedFailed => {
  expect((r as any).status).toBe('failed');
  return r as SeedFailed;
};

dbDescribe('seeding with list visibility (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let n = 40;
  const nextOrg = () => orgId(++n);
  const PLATFORM = orgId(39);
  const prev = process.env[PLATFORM_ORG_ENV];

  const platformRequest = (org: string, lists: any[], over: Partial<SeedApplyRequest> = {}): SeedApplyRequest => ({
    organizationId: org,
    scope: 'org',
    source: { app: 'platform', service: 'selection-list-service' },
    pack: { key: 'common-pack', version: 1 },
    trigger: 'org-created',
    requestId: null,
    lists,
    ...over,
  });
  const vis = async (org: string) =>
    Object.fromEntries((await db('selection_lists').where({ organization_id: org })).map((l: any) => [l.key, l.visibility]));

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    await allowSource(db, 'fuzecrm');
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    _resetPlatformOrgCacheForTesting();
    await projectOrg(db, PLATFORM, { type: 'platform' });
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env[PLATFORM_ORG_ENV];
    else process.env[PLATFORM_ORG_ENV] = prev;
    _resetPlatformOrgCacheForTesting();
    setFlagClient(null);
    await t.drop();
  });

  const lists = () => [
    spec('v-private', ['A']),
    spec('v-org', ['A'], { visibility: 'org' }),
    spec('v-common', ['A', 'B'], { visibility: 'platform' }),
  ];

  describe('honorVisibility OFF (the shared-lists flag is OFF): the 4.0.0 behaviour', () => {
    it('every list is seeded private, including one the pack declares org / platform', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const res = completed(await applySeedRequest(db, platformRequest(org, lists())));
      expect(res.lists.map((l) => l.key)).toEqual(['v-private', 'v-org', 'v-common']);
      expect(await vis(org)).toEqual({ 'v-private': 'private', 'v-org': 'private', 'v-common': 'private' });
    });
  });

  describe('honorVisibility ON', () => {
    it('a normal org: org -> org, private -> private, platform -> SKIPPED (no row, no result entry, not in the manifest)', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const before = await maxSeq(db);
      const res = completed(await applySeedRequest(db, platformRequest(org, lists(), { honorVisibility: true })));
      expect(res.lists.map((l) => l.key)).toEqual(['v-private', 'v-org']);
      expect(await vis(org)).toEqual({ 'v-private': 'private', 'v-org': 'org' });
      const ledger = await db('selection_list_seed_ledger').where({ organization_id: org }).first();
      expect(Object.keys(ledger.manifest).sort()).toEqual(['v-org', 'v-private']);
      // the created event snapshot carries the visibility
      const created = (await eventsAfter(db, before)).filter((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_CREATED);
      expect(Object.fromEntries(created.map((e) => [e.payload.listKey, e.payload.list.visibility]))).toEqual({ 'v-private': 'private', 'v-org': 'org' });
    });

    it('the platform org: the platform list is seeded ONCE as a common list; a replay writes nothing', async () => {
      const first = completed(await applySeedRequest(db, platformRequest(PLATFORM, lists(), { honorVisibility: true })));
      expect(first.lists.map((l) => `${l.key}:${l.action}`)).toEqual(['v-private:created', 'v-org:created', 'v-common:created']);
      expect(await vis(PLATFORM)).toEqual({ 'v-private': 'private', 'v-org': 'org', 'v-common': 'platform' });
      const common = await db('selection_lists').where({ organization_id: PLATFORM, key: 'v-common' }).first();
      expect(common).toMatchObject({ created_by: 'system:selection-list-service', seed_source: 'platform' });
      const seq = await maxSeq(db);
      const replay = completed(await applySeedRequest(db, platformRequest(PLATFORM, lists(), { honorVisibility: true })));
      expect(replay.outcome).toBe('already-applied');
      expect((await db('selection_lists').where({ organization_id: PLATFORM })).length).toBe(3);
      expect((await eventsAfter(db, seq)).filter((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_CREATED)).toEqual([]);
    });

    it('the common list is then served from the platform org only: a second ordinary org still gets no copy', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      completed(await applySeedRequest(db, platformRequest(org, lists(), { honorVisibility: true })));
      expect(await db('selection_lists').where({ organization_id: org, key: 'v-common' }).first()).toBeUndefined();
      expect(await db('selection_lists').where({ key: 'v-common', visibility: 'platform' }).count('* as n').first()).toMatchObject({ n: '1' });
    });

    it('platform org UNRESOLVED (nothing configured, nothing projected): platform lists are seeded nowhere', async () => {
      const keep = process.env[PLATFORM_ORG_ENV];
      delete process.env[PLATFORM_ORG_ENV];
      await db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: 'organization' });
      _resetPlatformOrgCacheForTesting();
      try {
        const org = nextOrg();
        await projectOrg(db, org);
        const res = completed(await applySeedRequest(db, platformRequest(org, lists(), { honorVisibility: true, pack: { key: 'common-pack-2', version: 1 } })));
        expect(res.lists.map((l) => l.key)).toEqual(['v-private', 'v-org']);
        // even a request addressed to the would-be platform org: it is not known to be one
        const other = lists().map((l) => ({ ...l, key: `x-${l.key}` }));
        const p2 = completed(await applySeedRequest(db, platformRequest(PLATFORM, other, { honorVisibility: true, pack: { key: 'common-pack-3', version: 1 } })));
        expect(p2.lists.map((l) => l.key)).toEqual(['x-v-private', 'x-v-org']);
      } finally {
        await db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: 'platform' });
        process.env[PLATFORM_ORG_ENV] = keep;
        _resetPlatformOrgCacheForTesting();
      }
    });

    it('visibility is applied at CREATION only: a later version never changes the visibility of a list it already seeded', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      completed(await applySeedRequest(db, platformRequest(org, [spec('u-list', ['A'])], { pack: { key: 'up-pack', version: 1 }, honorVisibility: true })));
      expect(await vis(org)).toEqual({ 'u-list': 'private' });
      // v2: same list now declared org, plus a new item -> content update, visibility NOT touched
      const v2 = completed(
        await applySeedRequest(db, platformRequest(org, [spec('u-list', ['A', 'B'], { visibility: 'org' })], { pack: { key: 'up-pack', version: 2 }, honorVisibility: true })),
      );
      expect(v2.lists[0].action).toBe('updated');
      expect(await vis(org)).toEqual({ 'u-list': 'private' });
    });

    it('a legacy per-org copy of a list the pack NOW declares common is untouched — not archived as "dropped from the pack"', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      completed(await applySeedRequest(db, platformRequest(org, [spec('l-keep', ['A']), spec('l-legacy', ['A', 'B'])], { pack: { key: 'legacy-pack', version: 1 } })));
      const legacy = await db('selection_lists').where({ organization_id: org, key: 'l-legacy' }).first();
      const v2 = completed(
        await applySeedRequest(
          db,
          platformRequest(org, [spec('l-keep', ['A']), spec('l-legacy', ['A', 'B'], { visibility: 'platform' })], { pack: { key: 'legacy-pack', version: 2 }, honorVisibility: true }),
        ),
      );
      expect(v2.lists.map((l) => l.key)).toEqual(['l-keep', 'l-legacy']); // the legacy copy reports "unchanged"
      expect(v2.lists.find((l) => l.key === 'l-legacy')!.action).toBe('unchanged');
      const after = await db('selection_lists').where({ id: legacy.id }).first();
      expect(after).toMatchObject({ status: 'active', visibility: 'private', key: 'l-legacy' });
      expect(after.id).toBe(legacy.id); // same id: the rollout job turns it into a fork of the common list
    });
  });

  describe('app requests (selection-lists.seed.requested)', () => {
    it('an app may seed org / private; platform is a VALIDATION_ERROR whatever the flag says; nothing is written', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      for (const honor of [true, false]) {
        const bad = failed(
          await applySeedRequest(db, appRequest(org, { honorVisibility: honor, lists: [spec('fuzecrm-common', ['A'], { visibility: 'platform' })], requestId: `r-${honor}` })),
        );
        expect(bad.reason).toBe('VALIDATION_ERROR');
        expect(bad.details[0]).toMatchObject({ listKey: 'fuzecrm-common', path: 'lists.0.visibility' });
      }
      expect((await db('selection_lists').where({ organization_id: org })).length).toBe(0);
      expect((await db('selection_list_seed_ledger').where({ organization_id: org })).length).toBe(0);
    });

    it('honorVisibility ON: org lists are readable by members; OFF: the same request seeds them private', async () => {
      const on = nextOrg();
      const off = nextOrg();
      await projectOrg(db, on);
      await projectOrg(db, off);
      const lists = [spec('fuzecrm-stages', ['LEAD'], { visibility: 'org' }), spec('fuzecrm-notes', ['X'])];
      completed(await applySeedRequest(db, appRequest(on, { honorVisibility: true, lists })));
      completed(await applySeedRequest(db, appRequest(off, { lists })));
      expect(await vis(on)).toEqual({ 'fuzecrm-stages': 'org', 'fuzecrm-notes': 'private' });
      expect(await vis(off)).toEqual({ 'fuzecrm-stages': 'private', 'fuzecrm-notes': 'private' });
    });
  });

  describe('the selection-lists.seed.requested handler reads the flag per message', () => {
    const event = (org: string, payload: Record<string, unknown> = {}) =>
      ({
        version: '1.0',
        topic: 'selection-lists.seed.requested',
        correlationId: 'corr-vis',
        occurredAt: '2026-10-04T00:00:00.000Z',
        payload: {
          requestId: `fuzecrm:vis-${org.slice(-6)}`,
          organizationId: org,
          scope: 'org',
          source: { app: 'fuzecrm', service: 'fuzecrm-service' },
          pack: { key: 'crm-defaults', version: 1 },
          trigger: 'app-installed',
          attestation: { kind: 'service-token', token: 'tok' },
          lists: [spec('fuzecrm-stages', ['LEAD'], { visibility: 'org' })],
          ...payload,
        },
      }) as any;
    const deps = () => ({ db, isSeedingEnabled: async () => true, verifyAttestation: async () => ({ ok: true as const, subject: FUZECRM_SUBJECT }), budget: new RetryBudget(5) });

    it('flag ON: an org-declared list is seeded org; flag OFF: private', async () => {
      const on = nextOrg();
      const off = nextOrg();
      await projectOrg(db, on);
      await projectOrg(db, off);
      setFlagClient(flagClientWith(true));
      expect(await handleSeedRequested(event(on), deps())).toMatchObject({ kind: 'result', result: { status: 'completed' } });
      setFlagClient(flagClientWith(false));
      expect(await handleSeedRequested(event(off), deps())).toMatchObject({ kind: 'result', result: { status: 'completed' } });
      expect(await vis(on)).toEqual({ 'fuzecrm-stages': 'org' });
      expect(await vis(off)).toEqual({ 'fuzecrm-stages': 'private' });
    });

    it('an app request declaring platform never reaches the library: the schema dead-letters it', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      setFlagClient(flagClientWith(true));
      const dead: string[] = [];
      const res = await handleSeedRequested(event(org, { lists: [spec('fuzecrm-x', ['A'], { visibility: 'platform' })] }), {
        ...deps(),
        deadLetter: async (_t: string, _e: unknown, reason: string) => {
          dead.push(reason);
        },
      });
      expect(res.kind).toBe('invalid');
      expect(dead.join(' ')).toMatch(/platform/);
      expect((await db('selection_lists').where({ organization_id: org })).length).toBe(0);
    });
  });

  describe('ledger semantics are unchanged', () => {
    it('a version\'s content is immutable INCLUDING the declared visibility (a visibility-only change needs a new version)', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const req = (visibility?: string) =>
        platformRequest(org, [spec('led-list', ['A'], visibility ? { visibility } : {})], { pack: { key: 'led-pack', version: 1 }, honorVisibility: true });
      completed(await applySeedRequest(db, req()));
      expect(completed(await applySeedRequest(db, req())).outcome).toBe('already-applied');
      expect(failed(await applySeedRequest(db, req('org'))).reason).toBe('PACK_CONTENT_MISMATCH');
    });

    it('the content hash is taken over the REQUESTED lists, independent of the target org (honouring does not change it)', async () => {
      const a = nextOrg();
      const b = nextOrg();
      await projectOrg(db, a);
      await projectOrg(db, b);
      completed(await applySeedRequest(db, platformRequest(a, lists(), { pack: { key: 'hash-pack', version: 1 }, honorVisibility: true })));
      completed(await applySeedRequest(db, platformRequest(b, lists(), { pack: { key: 'hash-pack', version: 1 }, honorVisibility: false })));
      const ha = (await db('selection_list_seed_ledger').where({ organization_id: a }).first()).content_hash;
      const hb = (await db('selection_list_seed_ledger').where({ organization_id: b }).first()).content_hash;
      expect(ha).toBe(hb);
    });
  });

  describe('applyPlatformDefaults reads the shared-lists flag per call', () => {
    let packDir: string;
    beforeAll(() => {
      packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-packs-'));
      fs.writeFileSync(
        path.join(packDir, 'common-defaults.v1.json'),
        JSON.stringify({
          packKey: 'common-defaults',
          version: 1,
          appliesTo: ['platform', 'organization', 'personal'],
          lists: [
            { key: 'cd-common', sourceLocale: 'en', name: 'Common', visibility: 'platform', items: [{ code: 'A', label: 'A' }] },
            { key: 'cd-org', sourceLocale: 'en', name: 'Org', visibility: 'org', items: [{ code: 'A', label: 'A' }] },
          ],
        }),
      );
    });
    afterAll(() => fs.rmSync(packDir, { recursive: true, force: true }));

    it('flag ON: the platform org gets the common list; an ordinary org only the org-visible one', async () => {
      setFlagClient(flagClientWith(true));
      const org = nextOrg();
      await projectOrg(db, org);
      const out = await applyPlatformDefaults(db, org, { packDir, grantListOwner: async () => undefined });
      completed(out[0].result);
      expect(await vis(org)).toEqual({ 'cd-org': 'org' });
      // the platform org (already projected as type platform)
      const p = await applyPlatformDefaults(db, PLATFORM, { packDir, grantListOwner: async () => undefined });
      completed(p[0].result);
      expect(await vis(PLATFORM)).toMatchObject({ 'cd-common': 'platform', 'cd-org': 'org' });
    });

    it('flag OFF: visibility is ignored and the pack is applied as it always was (private copies)', async () => {
      setFlagClient(flagClientWith(false));
      const org = nextOrg();
      await projectOrg(db, org);
      const out = await applyPlatformDefaults(db, org, { packDir, grantListOwner: async () => undefined });
      completed(out[0].result);
      expect(await vis(org)).toEqual({ 'cd-common': 'private', 'cd-org': 'private' });
    });
  });
});
