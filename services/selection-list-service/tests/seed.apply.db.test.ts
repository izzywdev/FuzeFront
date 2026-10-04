// seed.apply.db.test.ts - the seed algorithm (plan section 9) against REAL Postgres with the
// real migrations, the real outbox writer and the real emitters. Maps to the plan's test plan
// S1-S7 (platform) and R1-R12, R14, R15 (app); the Kafka-edge cases (R13 schema-invalid
// message, R6 token introspection) belong to the consumer stream.

import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { allowSource, appRequest, countBy, eventsAfter, FUZECRM_SUBJECT, maxSeq, orgId, projectOrg, spec } from './helpers/seedFixtures';
import {
  applyPlatformDefaults,
  applySeedRequest,
  loadPlatformPack,
  SEED_PRINCIPAL,
  type SeedFailed,
  type SeedCompleted,
} from '../src/seed';
import { hashCanonical } from '../src/seed/canonical';
import { hashItemContent, hashListContent, readItemContents, readListContents } from '../src/seed/content';

const completed = (r: unknown): SeedCompleted => {
  expect((r as any).status).toBe('completed');
  return r as SeedCompleted;
};
const failed = (r: unknown): SeedFailed => {
  expect((r as any).status).toBe('failed');
  return r as SeedFailed;
};

dbDescribe('seed algorithm (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let n = 10;
  const nextOrg = () => orgId(++n);

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    await allowSource(db, 'fuzecrm');
  });
  afterAll(async () => {
    await t.drop();
  });

  const listCount = async (org: string) => Number((await db('selection_lists').where({ organization_id: org }).count('id as c').first())!.c);
  const itemCount = async (org: string) =>
    Number((await db('selection_list_items as i').join('selection_lists as l', 'l.id', 'i.list_id').where('l.organization_id', org).count('i.id as c').first())!.c);
  const ledger = (org: string) => db('selection_list_seed_ledger').where({ organization_id: org });
  const everything = async (org: string) => ({
    lists: await listCount(org),
    items: await itemCount(org),
    ledger: (await ledger(org)).length,
    audit: Number((await db('selection_list_audit').count('id as c').first())!.c),
  });

  // ---------------------------------------------------------------------------
  describe('platform defaults (S1-S4)', () => {
    it('S1 happy path: 3 lists, 10 items, translations, ledger row, seed.completed applied, every event schema-valid', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const before = await maxSeq(db);

      const [outcome] = await applyPlatformDefaults(db, org);
      const res = completed(outcome.result);
      expect(res.outcome).toBe('applied');
      expect(res.appliedVersion).toBe(1);
      expect(res.lists.map((l) => `${l.key}:${l.action}:${l.itemsCreated}`)).toEqual(['yes-no:created:2', 'priority:created:4', 'work-status:created:4']);

      // rows
      const lists = await db('selection_lists').where({ organization_id: org }).orderBy('key');
      expect(lists.map((l) => l.key)).toEqual(['priority', 'work-status', 'yes-no']);
      for (const l of lists) {
        expect(l).toMatchObject({
          created_by: SEED_PRINCIPAL,
          status: 'active',
          seed_source: 'platform',
          seed_key: 'platform-defaults',
          seed_version: 1,
          seed_user_modified: false,
          is_seeded: true,
        });
        expect(l.seed_list_key).toBe(l.key);
        expect(l.id).toMatch(/^front_sl_[0-9a-z]+$/);
      }
      expect(await itemCount(org)).toBe(10);
      const prio = lists.find((l) => l.key === 'priority')!;
      const items = await db('selection_list_items').where({ list_id: prio.id }).orderBy('sort_order');
      expect(items.map((i) => [i.code, i.sort_order, i.created_by, i.seed_source])).toEqual([
        ['LOW', 100, SEED_PRINCIPAL, 'platform'],
        ['MEDIUM', 200, SEED_PRINCIPAL, 'platform'],
        ['HIGH', 300, SEED_PRINCIPAL, 'platform'],
        ['URGENT', 400, SEED_PRINCIPAL, 'platform'],
      ]);
      expect(items[0].id).toMatch(/^front_sli_[0-9a-z]+$/);
      // all 11 locales: the source row + 10 translations, per list and per item, none machine
      expect(await db('selection_list_translations').where({ list_id: prio.id })).toHaveLength(11);
      expect(await db('selection_list_item_translations').where({ item_id: items[0].id })).toHaveLength(11);
      expect(await db('selection_list_translations').where({ list_id: prio.id, is_machine: true })).toHaveLength(0);

      // the stored seed_hash IS the hash of what is in the database (so a fresh seed reads as unmodified)
      const contents = await readListContents(db, lists.map((l) => l.id));
      for (const l of lists) expect(hashListContent(contents.get(l.id)!)).toBe(l.seed_hash);
      const itemContents = await readItemContents(db, items.map((i) => i.id));
      for (const i of items) expect(hashItemContent(itemContents.get(i.id)!)).toBe(i.seed_hash);

      // ledger
      const [led] = await ledger(org);
      expect(led).toMatchObject({
        seed_source: 'platform',
        seed_key: 'platform-defaults',
        version: 1,
        scope: 'org',
        request_id: null,
        trigger: 'org-created',
        applied_by: SEED_PRINCIPAL,
        attested_subject: null,
      });
      expect(led.content_hash).toBe(hashCanonical(loadPlatformPack().lists));
      expect(led.manifest).toEqual({ 'yes-no': ['YES', 'NO'], priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], 'work-status': ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE'] });
      expect(led.result).toEqual(res.lists);

      // no per-instance list-owner grant for seeded lists (plan 9.2), audit rows with the system principal
      expect(await db('selection_list_access').whereIn('list_id', lists.map((l) => l.id))).toHaveLength(0);
      const audit = await db('selection_list_audit').whereIn('list_id', lists.map((l) => l.id));
      expect(audit).toHaveLength(3);
      expect(audit.every((a) => a.actor_id === SEED_PRINCIPAL && a.action === 'seed.applied')).toBe(true);
      expect(audit[0].after).toEqual({ seedSource: 'platform', packKey: 'platform-defaults', packVersion: 1, requestId: null, listId: audit[0].list_id, listKey: expect.any(String) });

      // events: 3 list.created, 10 item.created, 3*10 + 10*10 translation.upserted, 1 seed.completed - all written by the system actor
      const evs = await eventsAfter(db, before);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_LIST_CREATED)).toBe(3);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_ITEM_CREATED)).toBe(10);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED)).toBe(130);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_SEED_COMPLETED)).toBe(1);
      expect(evs).toHaveLength(3 + 10 + 130 + 1);
      expect(evs[evs.length - 1].topic).toBe(TOPICS.SELECTION_LISTS_SEED_COMPLETED);
      const created = evs.find((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_CREATED)!;
      expect(created.payload.actor).toEqual({ type: 'system', principal: 'selection-list-service', seedSource: 'platform' });
      expect(created.payload.list.seed).toEqual({ source: 'platform', packKey: 'platform-defaults', packVersion: 1, userModified: false });
      expect(evs[evs.length - 1].payload).toMatchObject({ outcome: 'applied', appliedVersion: 1, requestId: null, trigger: 'org-created', source: { app: 'platform' } });
      // listRevision strictly increases per list across list/item/translation events
      const byList = new Map<string, number[]>();
      for (const e of evs) if (e.payload.listRevision) byList.set(e.payload.listId, [...(byList.get(e.payload.listId) ?? []), e.payload.listRevision]);
      for (const revs of byList.values()) expect(revs).toEqual([...revs].sort((a, b) => a - b).filter((v, i, a) => a.indexOf(v) === i));
    });

    it('S2 duplicate delivery: already-applied with the recorded result, no new rows, no list/item events', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const first = completed((await applyPlatformDefaults(db, org))[0].result);
      const snap = await everything(org);
      const before = await maxSeq(db);

      const again = completed((await applyPlatformDefaults(db, org))[0].result);
      expect(again.outcome).toBe('already-applied');
      expect(again.lists).toEqual(first.lists);
      expect(again.eventId).not.toBe(first.eventId);
      expect(await everything(org)).toEqual(snap);
      const evs = await eventsAfter(db, before);
      expect(evs.map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_SEED_COMPLETED]);
      expect(evs[0].payload.outcome).toBe('already-applied');
    });

    it('S3 an org the projection marks inactive is skipped: nothing written, no ledger row, no event', async () => {
      const org = nextOrg();
      await projectOrg(db, org, { isActive: false });
      const before = await maxSeq(db);
      const out = await applyPlatformDefaults(db, org);
      expect(out).toEqual([{ packKey: 'platform-defaults', version: 1, skipped: 'org-inactive' }]);
      expect(await everything(org)).toMatchObject({ lists: 0, ledger: 0 });
      expect(await eventsAfter(db, before)).toEqual([]);
    });

    it('S4 the root platform org (type platform) is not seeded: appliesTo excludes it', async () => {
      const org = nextOrg();
      await projectOrg(db, org, { type: 'platform' });
      const out = await applyPlatformDefaults(db, org);
      expect(out[0].skipped).toBe('not-applicable');
      expect((await everything(org)).lists).toBe(0);
    });

    it('S6 an org the projection marks deleted is refused ORG_INACTIVE: no lists, seed.failed recorded', async () => {
      const org = nextOrg();
      await projectOrg(db, org, { status: 'deleted' });
      const [o] = await applyPlatformDefaults(db, org);
      const f = failed(o.result);
      expect(f.reason).toBe('ORG_INACTIVE');
      expect(f.retryable).toBe(false);
      expect(await everything(org)).toMatchObject({ lists: 0, ledger: 0 });
    });

    it('R12 an unknown org is refused ORG_UNKNOWN (retryable); once the org is projected the retry succeeds', async () => {
      const org = nextOrg();
      const f = failed((await applyPlatformDefaults(db, org))[0].result);
      expect(f.reason).toBe('ORG_UNKNOWN');
      expect(f.retryable).toBe(true);
      await projectOrg(db, org);
      expect(completed((await applyPlatformDefaults(db, org))[0].result).outcome).toBe('applied');
    });

    it('a backfill carries trigger "backfill" on the ledger row and the outcome event', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const before = await maxSeq(db);
      await applyPlatformDefaults(db, org, { trigger: 'backfill', correlationId: 'reconciler-1' });
      expect((await ledger(org))[0].trigger).toBe('backfill');
      const rows = await db('event_outbox').where('seq', '>', before);
      expect(rows.every((r) => r.correlation_id === 'reconciler-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('app sources (R1-R12)', () => {
    it('R1 happy path: provenance + created_by, ledger carries the attested subject and request id', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const res = completed(await applySeedRequest(db, appRequest(org)));
      expect(res.outcome).toBe('applied');
      const [list] = await db('selection_lists').where({ organization_id: org });
      expect(list).toMatchObject({ key: 'fuzecrm-stages', created_by: SEED_PRINCIPAL, seed_source: 'fuzecrm', seed_key: 'crm-defaults', seed_version: 1, seed_list_key: 'fuzecrm-stages' });
      const [led] = await ledger(org);
      expect(led).toMatchObject({ seed_source: 'fuzecrm', request_id: 'fuzecrm:req-1', trigger: 'app-installed', attested_subject: FUZECRM_SUBJECT });
    });

    it('R2 duplicate (same request, same content): already-applied with an identical lists result, nothing new written', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const a = completed(await applySeedRequest(db, appRequest(org)));
      const snap = await everything(org);
      const b = completed(await applySeedRequest(db, appRequest(org)));
      expect(b.outcome).toBe('already-applied');
      expect(b.lists).toEqual(a.lists);
      expect(await everything(org)).toEqual(snap);
    });

    it('R3 same version with different content: PACK_CONTENT_MISMATCH (not retryable), nothing written', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      await applySeedRequest(db, appRequest(org));
      const snap = await everything(org);
      const f = failed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-stages', ['LEAD', 'LOST'])] })));
      expect(f).toMatchObject({ reason: 'PACK_CONTENT_MISMATCH', retryable: false });
      expect(await everything(org)).toEqual(snap);
    });

    it('R4 an older version after a newer one: superseded, no changes', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 } }));
      const snap = await everything(org);
      const r = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 1 } })));
      expect(r).toMatchObject({ outcome: 'superseded', appliedVersion: 2, lists: [] });
      expect(await everything(org)).toEqual(snap);
    });

    it('R5 scope "user" is SCOPE_UNSUPPORTED (not retryable), nothing written', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const f = failed(await applySeedRequest(db, appRequest(org, { scope: 'user', userId: 'usr_01h455vb4pex5vsknk084sn02q' })));
      expect(f).toMatchObject({ reason: 'SCOPE_UNSUPPORTED', retryable: false });
      expect((await everything(org)).lists).toBe(0);
      const [ev] = (await eventsAfter(db, 0)).filter((e) => e.payload.organizationId === org);
      expect(ev.topic).toBe(TOPICS.SELECTION_LISTS_SEED_FAILED);
      expect(ev.payload).toMatchObject({ scope: 'user', userId: 'usr_01h455vb4pex5vsknk084sn02q', reason: 'SCOPE_UNSUPPORTED' });
    });

    it('R7 unknown source, disabled source, missing attestation and a subject not bound to the source are all refused', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      await allowSource(db, 'fuzedisabled', { enabled: false, prefixes: ['fuzedisabled-'] });
      const unknown = failed(await applySeedRequest(db, appRequest(org, { source: { app: 'fuzeunknown', service: 'x' }, lists: [spec('fuzeunknown-a', ['A'])] })));
      expect(unknown).toMatchObject({ reason: 'SOURCE_NOT_ALLOWED', retryable: false });
      const disabled = failed(await applySeedRequest(db, appRequest(org, { source: { app: 'fuzedisabled', service: 'x' }, lists: [spec('fuzedisabled-a', ['A'])] })));
      expect(disabled.reason).toBe('SOURCE_NOT_ALLOWED');
      const noSubject = failed(await applySeedRequest(db, appRequest(org, { attestedSubject: null })));
      expect(noSubject).toMatchObject({ reason: 'ATTESTATION_INVALID', retryable: true });
      const wrongSubject = failed(await applySeedRequest(db, appRequest(org, { attestedSubject: 'some-other-service' })));
      expect(wrongSubject).toMatchObject({ reason: 'SOURCE_NOT_ALLOWED', retryable: false });
      expect(await everything(org)).toMatchObject({ lists: 0, ledger: 0 });
      // the subject string never reaches an event
      const evs = (await eventsAfter(db, 0)).filter((e) => e.payload.organizationId === org);
      expect(JSON.stringify(evs)).not.toContain('some-other-service');
    });

    it('R8 a key outside the source key_prefixes is NAMESPACE_VIOLATION; over the per-request caps is LIMIT_EXCEEDED', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const ns = failed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-ok', ['A']), spec('other-stuff', ['A'])] })));
      expect(ns.reason).toBe('NAMESPACE_VIOLATION');
      expect(ns.details).toEqual([{ listKey: 'other-stuff', path: 'lists.1.key' }]);

      await allowSource(db, 'fuzetiny', { maxLists: 1, maxItems: 3, prefixes: ['fuzetiny-'], subjects: ['tiny-svc'] });
      const tiny = (lists: any[]) => appRequest(org, { source: { app: 'fuzetiny', service: 'tiny' }, attestedSubject: 'tiny-svc', pack: { key: 'tiny', version: 1 }, lists });
      const tooManyLists = failed(await applySeedRequest(db, tiny([spec('fuzetiny-a', ['A']), spec('fuzetiny-b', ['B'])])));
      expect(tooManyLists).toMatchObject({ reason: 'LIMIT_EXCEEDED', details: [{ quotaScope: 'request_lists', limit: 1, requested: 2 }] });
      const tooManyItems = failed(await applySeedRequest(db, tiny([spec('fuzetiny-a', ['A', 'B', 'C', 'D'])])));
      expect(tooManyItems).toMatchObject({ reason: 'LIMIT_EXCEEDED', details: [{ quotaScope: 'request_items', limit: 3, requested: 4 }] });
      expect((await everything(org)).lists).toBe(0);
    });

    it('a schema-invalid request is VALIDATION_ERROR (duplicate list keys; a smuggled id)', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const dup = failed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-a', ['A']), spec('fuzecrm-a', ['B'])] })));
      expect(dup.reason).toBe('VALIDATION_ERROR');
      const smuggled = failed(await applySeedRequest(db, appRequest(org, { lists: [{ ...spec('fuzecrm-a', ['A']), id: 'front_sl_attacker' } as any] })));
      expect(smuggled.reason).toBe('VALIDATION_ERROR');
      expect((await everything(org)).lists).toBe(0);
    });

    it('R9 partial failure is impossible: a 3rd list over the item quota writes nothing for lists 1-2 (QUOTA_EXCEEDED, details populated)', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      await db('selection_list_org_quota').insert({ organization_id: org, max_items_per_list: 3, updated_by: 'test' });
      const snap = await everything(org);
      const f = failed(
        await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-a', ['A', 'B']), spec('fuzecrm-b', ['A']), spec('fuzecrm-c', ['A', 'B', 'C', 'D'])] })),
      );
      expect(f).toMatchObject({ reason: 'QUOTA_EXCEEDED', retryable: true });
      expect(f.details).toEqual([{ quotaScope: 'list_items', listKey: 'fuzecrm-c', limit: 3, current: 0, requested: 4 }]);
      expect(await everything(org)).toEqual(snap);
      const evs = (await eventsAfter(db, 0)).filter((e) => e.payload.organizationId === org);
      expect(evs.map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_SEED_FAILED]);
    });

    it('R10 org quota: 99/100 lists used + 2 seeded lists is QUOTA_EXCEEDED, nothing written; one list fits', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      for (let i = 0; i < 99; i++) {
        await db('selection_lists').insert({ id: `front_sl_q${org.slice(-6)}${i}`, organization_id: org, key: `user-list-${i}`, created_by: 'usr_x' });
      }
      const f = failed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-a', ['A']), spec('fuzecrm-b', ['A'])] })));
      expect(f).toMatchObject({ reason: 'QUOTA_EXCEEDED' });
      expect(f.details).toEqual([{ quotaScope: 'org_lists', limit: 100, current: 99, requested: 2 }]);
      expect(await listCount(org)).toBe(99);
      expect(await ledger(org)).toHaveLength(0);
      // seeded lists DO count toward the org quota, and the per-user cap (20) does not apply to the system principal
      expect(completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-one', version: 1 }, lists: [spec('fuzecrm-a', ['A'])] }))).outcome).toBe('applied');
      expect(await listCount(org)).toBe(100);
    });

    it('seeded lists are not subject to the per-user list cap (created_by is the system principal)', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const lists = Array.from({ length: 20 }, (_, i) => spec(`fuzecrm-l${i}`, ['A']));
      expect(completed(await applySeedRequest(db, appRequest(org, { lists }))).lists).toHaveLength(20);
      expect(completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-two', version: 1 }, lists: [spec('fuzecrm-extra', ['A'])] }))).outcome).toBe('applied');
      expect(await listCount(org)).toBe(21);
    });

    it('R11 a key taken by a user list is KEY_CONFLICT (retryable); after the user renames theirs the retry succeeds', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      await db('selection_lists').insert({ id: `front_sl_conflict${org.slice(-6)}`, organization_id: org, key: 'fuzecrm-stages', created_by: 'usr_x' });
      const f = failed(await applySeedRequest(db, appRequest(org)));
      expect(f).toMatchObject({ reason: 'KEY_CONFLICT', retryable: true, details: [{ listKey: 'fuzecrm-stages', path: 'lists.0.key' }] });
      expect(await listCount(org)).toBe(1);
      expect(await ledger(org)).toHaveLength(0);
      await db('selection_lists').where({ organization_id: org }).update({ key: 'my-own-stages' });
      expect(completed(await applySeedRequest(db, appRequest(org))).outcome).toBe('applied');
      expect(await listCount(org)).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('atomicity and concurrency', () => {
    it('rolls back EVERYTHING when a write fails mid-request: no partial data, seed.failed INTERNAL_ERROR recorded', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      await db.raw(`
        CREATE OR REPLACE FUNCTION sl_test_boom() RETURNS trigger AS $$
        BEGIN
          IF NEW.code = 'BOOM' THEN RAISE EXCEPTION 'boom (test fault injection)'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await db.raw('CREATE TRIGGER sl_test_boom_trg BEFORE INSERT ON selection_list_items FOR EACH ROW EXECUTE FUNCTION sl_test_boom()');
      try {
        const snap = await everything(org);
        const before = await maxSeq(db);
        const f = failed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-a', ['A', 'B']), spec('fuzecrm-b', ['A', 'BOOM'])] })));
        expect(f).toMatchObject({ reason: 'INTERNAL_ERROR', retryable: true });
        expect(f.message).not.toMatch(/boom/i); // internals do not leak into the outcome
        expect(await everything(org)).toEqual(snap);
        expect((await eventsAfter(db, before)).map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_SEED_FAILED]);

        // with internalErrors:'throw' the caller's own retry applies; still nothing written, no event
        const before2 = await maxSeq(db);
        await expect(applySeedRequest(db, appRequest(org, { internalErrors: 'throw', lists: [spec('fuzecrm-a', ['A']), spec('fuzecrm-b', ['BOOM'])] }))).rejects.toThrow(/boom/);
        expect(await everything(org)).toEqual(snap);
        expect(await eventsAfter(db, before2)).toEqual([]);
      } finally {
        await db.raw('DROP TRIGGER IF EXISTS sl_test_boom_trg ON selection_list_items');
      }
      // the fault is gone: the same request now applies cleanly (nothing was left half-done to trip over)
      expect(completed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-a', ['A', 'B']), spec('fuzecrm-b', ['A', 'BOOM'])] }))).outcome).toBe('applied');
    });

    it('R14 two simultaneous identical requests: one applied, one already-applied, exactly one set of rows', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const results = await Promise.all([applySeedRequest(db, appRequest(org)), applySeedRequest(db, appRequest(org)), applySeedRequest(db, appRequest(org))]);
      const outcomes = results.map((r) => completed(r).outcome).sort();
      expect(outcomes).toEqual(['already-applied', 'already-applied', 'applied']);
      expect(await listCount(org)).toBe(1);
      expect(await ledger(org)).toHaveLength(1);
      expect(Number((await db('event_outbox').where({ organization_id: org, topic: TOPICS.SELECTION_LISTS_LIST_CREATED }).count('id as c').first())!.c)).toBe(1);
    });

    it('concurrent seeds of DIFFERENT packs for one org serialise without deadlocking and all apply', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => applySeedRequest(db, appRequest(org, { pack: { key: `crm-p${i}`, version: 1 }, lists: [spec(`fuzecrm-p${i}`, ['A'])] }))),
      );
      expect(results.map((r) => completed(r).outcome)).toEqual(['applied', 'applied', 'applied', 'applied']);
      expect(await listCount(org)).toBe(4);
    });

    it('the library does not read feature flags: it applies with every flag OFF (the flag is the callers\' check)', async () => {
      const { setFlagClient } = await import('../src/flags');
      setFlagClient({ getBooleanValue: async () => false });
      try {
        const org = nextOrg();
        await projectOrg(db, org);
        expect(completed(await applySeedRequest(db, appRequest(org))).outcome).toBe('applied');
        const [o] = await applyPlatformDefaults(db, org);
        expect(completed(o.result).outcome).toBe('applied');
      } finally {
        setFlagClient(null);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('versions, user edits, user deletes (S7)', () => {
    const v1 = [
      spec('fuzecrm-stages', ['LEAD', 'QUALIFIED', 'WON']),
      spec('fuzecrm-sources', ['WEB', 'REFERRAL']),
      spec('fuzecrm-regions', ['EMEA', 'APAC']),
      spec('fuzecrm-legacy', ['OLD']),
    ];

    async function setup() {
      const org = nextOrg();
      await projectOrg(db, org);
      completed(await applySeedRequest(db, appRequest(org, { lists: v1 })));
      const row = async (key: string) => (await db('selection_lists').where({ organization_id: org, seed_list_key: key }).first())!;
      const item = async (key: string, code: string) => (await db('selection_list_items').where({ list_id: (await row(key)).id, code }).first())!;
      return { org, row, item };
    }

    it('S7 pack v2: unedited list updated, edited list skipped, purged list not recreated, dropped list archived, new items appended, existing order untouched', async () => {
      const { org, row, item } = await setup();
      const stagesId = (await row('fuzecrm-stages')).id;
      const orderBefore = (await db('selection_list_items').where({ list_id: stagesId }).orderBy('sort_order')).map((i) => [i.code, i.sort_order, i.id]);

      // a human edits the "sources" list (renames it AND retitles it) and purges the "regions" list entirely
      const sources = await row('fuzecrm-sources');
      await db('selection_list_translations').where({ list_id: sources.id, locale: 'en' }).update({ name: 'Where leads come from' });
      await db('selection_lists').where({ id: sources.id }).update({ key: 'lead-sources' }); // rename: must still be found by provenance
      const regions = await row('fuzecrm-regions');
      await db('selection_list_item_translations').whereIn('item_id', db('selection_list_items').where({ list_id: regions.id }).select('id')).delete();
      await db('selection_list_items').where({ list_id: regions.id }).delete();
      await db('selection_list_translations').where({ list_id: regions.id }).delete();
      await db('selection_list_audit').where({ list_id: regions.id }).update({ list_id: null }); // what the purge route does (audit rows are detached, not lost)
      await db('selection_lists').where({ id: regions.id }).delete();
      // and edits the QUALIFIED item of the (otherwise untouched) stages list
      const qualified = await item('fuzecrm-stages', 'QUALIFIED');
      await db('selection_list_item_translations').where({ item_id: qualified.id, locale: 'en' }).update({ label: 'Sales qualified' });
      // and archives the WON item
      const won = await item('fuzecrm-stages', 'WON');
      await db('selection_list_items').where({ id: won.id }).update({ status: 'archived' });

      const v2 = [
        // stages: LEAD relabelled, QUALIFIED changed upstream (but user-edited -> skipped), WON dropped?? no: kept, NEW added
        spec('fuzecrm-stages', [{ code: 'LEAD', label: 'New lead' }, { code: 'QUALIFIED', label: 'Qualified' }, 'WON', 'NURTURE']),
        spec('fuzecrm-sources', ['WEB', 'REFERRAL', 'EVENT']), // edited by a human -> skip the whole list
        spec('fuzecrm-regions', ['EMEA', 'APAC', 'LATAM']), // purged by a human -> never recreated
        spec('fuzecrm-fresh', ['A']), // brand new list in v2
        // fuzecrm-legacy is DROPPED from the pack -> archived
      ];
      const before = await maxSeq(db);
      const res = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: v2, requestId: 'fuzecrm:req-2' })));
      expect(res.outcome).toBe('upgraded');
      expect(res.appliedVersion).toBe(2);
      const byKey = Object.fromEntries(res.lists.map((l) => [l.key, l]));
      expect(byKey['fuzecrm-stages']).toMatchObject({ action: 'updated', itemsCreated: 1, itemsUpdated: 1, itemsArchived: 0, itemsSkipped: 2 }); // NURTURE new; LEAD relabelled; QUALIFIED+WON skipped
      expect(byKey['fuzecrm-sources']).toMatchObject({ action: 'skipped-user-edited', itemsSkipped: 3 });
      expect(byKey['fuzecrm-regions']).toMatchObject({ action: 'skipped-user-deleted', listId: null });
      expect(byKey['fuzecrm-fresh']).toMatchObject({ action: 'created', itemsCreated: 1 });
      expect(byKey['fuzecrm-legacy']).toMatchObject({ action: 'archived' });

      // stages: relabelled item, appended item AFTER the current max, existing order untouched, user edits preserved
      const items = await db('selection_list_items').where({ list_id: stagesId }).orderBy('sort_order');
      expect(items.map((i) => [i.code, i.sort_order])).toEqual([['LEAD', 100], ['QUALIFIED', 200], ['WON', 300], ['NURTURE', 400]]);
      expect(items.slice(0, 3).map((i) => i.id)).toEqual(orderBefore.map((o) => o[2]));
      const label = async (itemId: string) => (await db('selection_list_item_translations').where({ item_id: itemId, locale: 'en' }).first())!.label;
      expect(await label(items[0].id)).toBe('New lead');
      expect(await label(qualified.id)).toBe('Sales qualified'); // the user's edit survives
      expect((await item('fuzecrm-stages', 'WON')).status).toBe('archived'); // the user's archive survives
      expect((await item('fuzecrm-stages', 'LEAD')).seed_version).toBe(2);
      expect((await item('fuzecrm-stages', 'QUALIFIED')).seed_user_modified).toBe(true);
      expect((await item('fuzecrm-stages', 'QUALIFIED')).seed_version).toBe(1);
      // and the stages list itself is unmodified (an item edit does not make the list user-edited)
      expect((await row('fuzecrm-stages')).seed_user_modified).toBe(false);

      // sources: the renamed list is left entirely alone, and now persistently flagged
      const sourcesAfter = await db('selection_lists').where({ id: sources.id }).first();
      expect(sourcesAfter).toMatchObject({ key: 'lead-sources', seed_user_modified: true, seed_version: 1 });
      expect(await db('selection_list_items').where({ list_id: sources.id })).toHaveLength(2);
      expect((await db('selection_list_translations').where({ list_id: sources.id, locale: 'en' }).first())!.name).toBe('Where leads come from');

      // regions: not recreated; fresh: created; legacy: archived but still resolves
      expect(await db('selection_lists').where({ organization_id: org, seed_list_key: 'fuzecrm-regions' })).toHaveLength(0);
      expect(await db('selection_lists').where({ organization_id: org, key: 'fuzecrm-regions' })).toHaveLength(0);
      expect((await row('fuzecrm-fresh')).status).toBe('active');
      const legacy = await row('fuzecrm-legacy');
      expect(legacy.status).toBe('archived');
      expect(await db('selection_list_items').where({ list_id: legacy.id })).toHaveLength(1);

      // ledger: v2 recorded alongside v1; manifest of v2; audit upgrade/archived rows
      expect((await ledger(org)).map((l) => l.version).sort()).toEqual([1, 2]);
      const actions = (await db('selection_list_audit').whereIn('list_id', [stagesId, legacy.id]).orderBy('occurred_at')).map((a) => `${a.list_id === stagesId ? 'stages' : 'legacy'}:${a.action}`);
      expect(actions).toEqual(expect.arrayContaining(['stages:seed.upgraded', 'legacy:seed.archived']));

      // events: only for what actually changed
      const evs = await eventsAfter(db, before);
      const topics = evs.map((e) => e.topic);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_LIST_ARCHIVED)).toBe(1); // legacy
      expect(countBy(evs, TOPICS.SELECTION_LISTS_LIST_CREATED)).toBe(1); // fresh
      expect(countBy(evs, TOPICS.SELECTION_LISTS_ITEM_CREATED)).toBe(2); // NURTURE + fresh's A
      expect(countBy(evs, TOPICS.SELECTION_LISTS_ITEM_UPDATED)).toBe(1); // LEAD
      expect(topics[topics.length - 1]).toBe(TOPICS.SELECTION_LISTS_SEED_COMPLETED);
      expect(evs[evs.length - 1].payload).toMatchObject({ outcome: 'upgraded', appliedVersion: 2, requestId: 'fuzecrm:req-2' });
      // the user's retitled list produced no event at all
      expect(evs.some((e) => e.payload.listId === sources.id)).toBe(false);
    });

    it('v2 items dropped from the pack are archived (still resolve), user-edited ones are left, and a dropped item re-added later is restored', async () => {
      const { org, row, item } = await setup();
      const edited = await item('fuzecrm-stages', 'QUALIFIED');
      await db('selection_list_item_translations').where({ item_id: edited.id, locale: 'en' }).update({ label: 'My qualified' });

      const v2 = [spec('fuzecrm-stages', ['LEAD']), v1[1], v1[2], v1[3]]; // drops QUALIFIED (edited) and WON (untouched)
      const r2 = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: v2 })));
      expect(r2.lists.find((l) => l.key === 'fuzecrm-stages')).toMatchObject({ itemsArchived: 1, itemsSkipped: 1 });
      expect((await item('fuzecrm-stages', 'WON')).status).toBe('archived');
      expect((await item('fuzecrm-stages', 'QUALIFIED')).status).toBe('active'); // user-edited: left alone

      // v3 brings WON back: the (still unmodified) archived row is restored in place
      const wonId = (await item('fuzecrm-stages', 'WON')).id;
      const r3 = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 3 }, lists: [spec('fuzecrm-stages', ['LEAD', 'WON']), v1[1], v1[2], v1[3]] })));
      expect(r3.lists.find((l) => l.key === 'fuzecrm-stages')).toMatchObject({ itemsUpdated: 1 });
      expect(await db('selection_list_items').where({ id: wonId }).first()).toMatchObject({ status: 'active', seed_user_modified: false });
      expect((await row('fuzecrm-stages')).seed_user_modified).toBe(false);
    });

    it('a list dropped from the pack that a human edited is left alone; one a human already archived stays archived', async () => {
      const { org, row } = await setup();
      const legacy = await row('fuzecrm-legacy');
      await db('selection_list_translations').where({ list_id: legacy.id, locale: 'en' }).update({ name: 'Legacy (mine)' });
      const sources = await row('fuzecrm-sources');
      await db('selection_lists').where({ id: sources.id }).update({ status: 'archived' }); // a human archives it
      const r = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: [v1[0], v1[2]] })));
      const byKey = Object.fromEntries(r.lists.map((l) => [l.key, l.action]));
      expect(byKey).toMatchObject({ 'fuzecrm-legacy': 'skipped-user-edited', 'fuzecrm-sources': 'skipped-user-edited', 'fuzecrm-stages': 'unchanged', 'fuzecrm-regions': 'unchanged' });
      expect((await row('fuzecrm-legacy')).status).toBe('active');
      expect((await row('fuzecrm-sources')).status).toBe('archived');
    });

    it('an unchanged v2 is recorded (version moves forward) without touching a single row or emitting list/item events', async () => {
      const { org } = await setup();
      const snap = await everything(org);
      const before = await maxSeq(db);
      const r = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: v1 })));
      expect(r.outcome).toBe('upgraded');
      expect(r.lists.every((l) => l.action === 'unchanged')).toBe(true);
      expect({ ...(await everything(org)), ledger: 0 }).toEqual({ ...snap, ledger: 0 });
      expect((await eventsAfter(db, before)).map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_SEED_COMPLETED]);
    });

    it('a human-written translation counts as an edit; a machine (autofill) translation does not', async () => {
      const { org, row } = await setup();
      const stages = await row('fuzecrm-stages');
      const sources = await row('fuzecrm-sources');
      // autofill writes a machine translation on stages: NOT an edit
      await db('selection_list_translations').insert({ list_id: stages.id, locale: 'fr', name: '[MT] stages', is_machine: true });
      // a human adds a French translation on sources: an edit
      await db('selection_list_translations').insert({ list_id: sources.id, locale: 'fr', name: 'Sources', is_machine: false });
      const r = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: [spec('fuzecrm-stages', ['LEAD', 'QUALIFIED', 'WON', 'NEW']), spec('fuzecrm-sources', ['WEB', 'REFERRAL', 'NEW']), v1[2], v1[3]] })));
      const byKey = Object.fromEntries(r.lists.map((l) => [l.key, l.action]));
      expect(byKey['fuzecrm-stages']).toBe('updated');
      expect(byKey['fuzecrm-sources']).toBe('skipped-user-edited');
      // the seeder never touched the machine row it did not write
      expect((await db('selection_list_translations').where({ list_id: stages.id, locale: 'fr' }).first())!.is_machine).toBe(true);
    });

    it('a user who purged a seeded ITEM does not get it back on upgrade', async () => {
      const { org, item } = await setup();
      const lead = await item('fuzecrm-stages', 'LEAD');
      await db('selection_list_item_translations').where({ item_id: lead.id }).delete();
      await db('selection_list_items').where({ id: lead.id }).delete();
      const r = completed(await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: [spec('fuzecrm-stages', ['LEAD', 'QUALIFIED', 'WON', 'EXTRA']), v1[1], v1[2], v1[3]] })));
      expect(r.lists.find((l) => l.key === 'fuzecrm-stages')).toMatchObject({ itemsCreated: 1, itemsSkipped: 1 });
      expect(await db('selection_list_items').where({ list_id: (await db('selection_lists').where({ organization_id: org, seed_list_key: 'fuzecrm-stages' }).first())!.id, code: 'LEAD' })).toHaveLength(0);
    });

    it('sourceLocale / translation changes in a new version are applied to an unedited list (translations upserted, dropped ones removed)', async () => {
      const org = nextOrg();
      await projectOrg(db, org);
      completed(await applySeedRequest(db, appRequest(org, { lists: [spec('fuzecrm-a', ['X'], { translations: [{ locale: 'es', name: 'A es' }, { locale: 'fr', name: 'A fr' }] })] })));
      const before = await maxSeq(db);
      const r = completed(
        await applySeedRequest(db, appRequest(org, { pack: { key: 'crm-defaults', version: 2 }, lists: [spec('fuzecrm-a', ['X'], { name: 'A renamed', translations: [{ locale: 'es', name: 'A es 2' }, { locale: 'de', name: 'A de' }] })] })),
      );
      expect(r.lists[0].action).toBe('updated');
      const list = (await db('selection_lists').where({ organization_id: org }).first())!;
      const trs = Object.fromEntries((await db('selection_list_translations').where({ list_id: list.id })).map((x) => [x.locale, x.name]));
      expect(trs).toEqual({ en: 'A renamed', es: 'A es 2', de: 'A de' });
      const evs = await eventsAfter(db, before);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_LIST_UPDATED)).toBe(1);
      expect(countBy(evs, TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED)).toBe(2); // es (changed) + de (new); the item's translations are unchanged
      expect(countBy(evs, TOPICS.SELECTION_LISTS_TRANSLATION_DELETED)).toBe(1); // fr
      // the item is unchanged => no item events
      expect(countBy(evs, TOPICS.SELECTION_LISTS_ITEM_UPDATED)).toBe(0);
      // and the list is still unmodified afterwards
      expect((await db('selection_lists').where({ id: list.id }).first())!.seed_user_modified).toBe(false);
    });
  });
});
