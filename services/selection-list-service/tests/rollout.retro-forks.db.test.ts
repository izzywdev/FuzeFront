// rollout.retro-forks.db.test.ts - design record 9.6 on REAL Postgres: the per-organization copies of the platform pack
// lists become FORKS of the common lists. Dry run writes nothing; apply sets provenance + origin_item_id by `code` and
// enqueues a synthetic selection-lists.list.forked in the same transaction; a re-run is a no-op; copies that are not
// copies (renamed, user-authored, other pack, the platform org's own, already forks, legacy org ids) are left alone with
// a reason; duplicates must be reconciled first; safe against a writer holding the org outbox lock; flag-independent.

import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { lockOrgOutbox } from '../src/events/outbox';
import { _resetPlatformOrgCacheForTesting } from '../src/lib/sharedLists';
import { runReconcileDuplicates } from '../src/rollout/duplicates';
import { runRetroForks } from '../src/rollout/retroForks';
import { RolloutPreconditionError, exitCodeFor } from '../src/rollout/common';
import { createRolloutWorld, dump, orgPair, PLATFORM, RolloutWorld, runbookSql } from './helpers/rolloutWorld';
import { dbDescribe } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));
const flagReads: string[] = [];
jest.mock('../src/flags', () =>
  new Proxy(
    {},
    {
      get: (_t, p) =>
        p === '__esModule'
          ? false
          : () => {
              flagReads.push(String(p));
              throw new Error(`the rollout jobs must not read a flag (${String(p)})`);
            },
    },
  ),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PACK = { source: 'platform', key: 'platform-defaults' };
const seeded = (listKey: string, key = PACK.key) => ({ source: PACK.source, key, listKey });

dbDescribe('rollout: retro-forks (design record 9.6) on real Postgres', () => {
  let w: RolloutWorld;
  let seq = 200;
  const newOrg = () => orgPair(++seq);

  beforeAll(async () => {
    w = await createRolloutWorld(state);
  });
  afterAll(async () => {
    delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    _resetPlatformOrgCacheForTesting();
    await w.teardown();
  });
  beforeEach(async () => {
    await w.db.raw('TRUNCATE selection_lists, selection_list_items, selection_list_translations, selection_list_item_translations, event_outbox, selection_list_ref_index, selection_list_access RESTART IDENTITY CASCADE');
    process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM.wire;
    await w.projectOrg(PLATFORM, 'platform');
    _resetPlatformOrgCacheForTesting();
    flagReads.length = 0;
  });
  afterEach(() => expect(flagReads).toEqual([]));

  const get = (id: string) => w.db('selection_lists').where({ id }).first();
  const items = (listId: string) => w.db('selection_list_items').where({ list_id: listId }).orderBy('code');
  const events = async (listId: string) => (await w.db('event_outbox').whereRaw(`payload->>'listId' = ?`, [listId]).orderBy('seq')).map((r: any) => ({ topic: r.topic, p: r.payload, org: r.organization_id, corr: r.correlation_id }));

  /** The common lists (published by an operator) and a spread of organizations holding copies. */
  async function world() {
    const yes = await w.insertList({ key: 'yes-no', org: PLATFORM.wire, visibility: 'platform', seed: seeded('yes-no'), name: 'Yes / No' });
    const yesItems = { YES: await w.insertItem(yes, 'YES'), NO: await w.insertItem(yes, 'NO'), OLD: await w.insertItem(yes, 'OLD', { status: 'archived' }) };
    const prio = await w.insertList({ key: 'priority', org: PLATFORM.wire, visibility: 'platform', seed: seeded('priority') });
    const prioItems = { LOW: await w.insertItem(prio, 'LOW'), HIGH: await w.insertItem(prio, 'HIGH') };
    await w.db('selection_lists').where({ id: yes }).update({ revision: 7 });

    const a = newOrg(); // wire rendering, edited copy with a custom item
    const copyA = await w.insertList({ key: 'yes-no', org: a.wire, visibility: 'org', seed: seeded('yes-no'), name: 'Our yes/no', ageMin: 60 });
    const itemsA = { YES: await w.insertItem(copyA, 'YES'), NO: await w.insertItem(copyA, 'NO'), MAYBE: await w.insertItem(copyA, 'MAYBE') };
    const b = newOrg(); // bare-UUID rendering, archived copy of the other list
    const copyB = await w.insertList({ key: 'priority', org: b.uuid, status: 'archived', visibility: 'private', seed: seeded('priority') });
    const itemsB = { LOW: await w.insertItem(copyB, 'LOW'), HIGH: await w.insertItem(copyB, 'HIGH') };
    return { yes, yesItems, prio, prioItems, a, copyA, itemsA, b, copyB, itemsB };
  }

  describe('--dry-run', () => {
    it('lists exactly what would become a fork (with the item counts) and WRITES NOTHING', async () => {
      const x = await world();
      const before = await dump(w.db);
      const report = await runRetroForks(w.db, 'dry-run');
      expect(await dump(w.db)).toBe(before);
      expect(report.mode).toBe('dry-run');
      expect(report.changes.map((c) => [c.listId, c.detail])).toEqual(
        [[x.copyA, { key: 'yes-no', common: x.yes, itemsMapped: 2 }], [x.copyB, { key: 'priority', common: x.prio, itemsMapped: 2 }]].sort((p: any, q: any) => (p[0] < q[0] ? -1 : 1)),
      );
      expect(report.summary).toMatchObject({ commonLists: 2, candidateCopies: 2, wouldFork: 2, leftAlone: 0 });
      expect(exitCodeFor(report)).toBe(0);
    });
  });

  describe('--apply', () => {
    it('sets provenance on the copy, maps items by code, and keeps its id, visibility, edits and custom items', async () => {
      const x = await world();
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes).toHaveLength(2);
      const a = await get(x.copyA);
      expect(a).toMatchObject({
        id: x.copyA,
        organization_id: x.a.wire,
        key: 'yes-no',
        visibility: 'org', // kept
        status: 'active',
        forked_from_list_id: x.yes,
        forked_from_org_id: PLATFORM.wire,
        forked_at: expect.any(Date),
      });
      expect(Number(a.forked_from_revision)).toBe(7); // the common list's revision NOW
      expect((await w.db('selection_list_translations').where({ list_id: x.copyA }).first()).name).toBe('Our yes/no'); // the edit stays
      const ia = await items(x.copyA);
      expect(Object.fromEntries(ia.map((i: any) => [i.code, i.origin_item_id]))).toEqual({ YES: x.yesItems.YES, NO: x.yesItems.NO, MAYBE: null });
      expect(ia.map((i: any) => i.id).sort()).toEqual(Object.values(x.itemsA).sort()); // item ids kept
      // the archived copy (bare-UUID rendering) is converted too, its status and visibility kept
      expect(await get(x.copyB)).toMatchObject({ forked_from_list_id: x.prio, status: 'archived', visibility: 'private', organization_id: x.b.uuid });
      expect((await items(x.copyB)).map((i: any) => i.origin_item_id).sort()).toEqual(Object.values(x.prioItems).sort());
      // the common lists themselves are untouched
      expect(await get(x.yes)).toMatchObject({ forked_from_list_id: null, visibility: 'platform' });
    });

    it('enqueues ONE schema-valid selection-lists.list.forked per copy, in the same transaction, announced under the copy\'s org', async () => {
      const x = await world();
      const revBefore = Number((await get(x.copyA)).revision);
      const report = await runRetroForks(w.db, 'apply');
      const ev = await events(x.copyA);
      expect(ev.map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_FORKED]); // validated by SCHEMA_BY_TOPIC on enqueue
      expect(ev[0].p).toMatchObject({
        organizationId: x.a.wire,
        listId: x.copyA,
        listKey: 'yes-no',
        listRevision: revBefore + 1,
        source: { listId: x.yes, organizationId: PLATFORM.wire, listKey: 'yes-no', listRevision: 7 },
        list: { visibility: 'org', forkedFrom: { listId: x.yes, organizationId: PLATFORM.wire, listRevision: 7 } },
        actor: { type: 'system', principal: 'selection-list-service', seedSource: null },
      });
      expect([...ev[0].p.itemMap].sort((p: any, q: any) => (p.originItemId < q.originItemId ? -1 : 1))).toEqual(
        [{ originItemId: x.yesItems.YES, itemId: x.itemsA.YES }, { originItemId: x.yesItems.NO, itemId: x.itemsA.NO }].sort((p, q) => (p.originItemId < q.originItemId ? -1 : 1)),
      );
      expect(ev[0].corr).toBe(`rollout:retro-forks:${report.runId}`);
      expect((await events(x.copyB))[0].org).toBe(x.b.wire); // the bare-UUID copy is announced under the wire id
      expect(await events(x.yes)).toEqual([]);
      expect(Number((await get(x.copyA)).revision)).toBe(revBefore + 1);
    });

    it('the runbook ROLLBACK statement undoes exactly one run (provenance and origin ids cleared; ids, items, edits untouched) and the job can redo it', async () => {
      const x = await world();
      const copyBefore = await get(x.copyA);
      const itemsBefore = (await items(x.copyA)).map((i: any) => i.id);
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes).toHaveLength(2);
      await w.db.raw(runbookSql('-- ROLLBACK retro-forks').replace(/<runId>/g, report.runId));
      expect(await get(x.copyA)).toMatchObject({ forked_from_list_id: null, forked_from_org_id: null, forked_from_revision: null, forked_at: null, key: copyBefore.key, visibility: 'org' });
      expect((await items(x.copyA)).every((i: any) => i.origin_item_id === null)).toBe(true);
      expect((await items(x.copyA)).map((i: any) => i.id)).toEqual(itemsBefore);
      expect(await w.db('selection_lists').whereNotNull('forked_from_list_id').count<{ n: string }>('* as n').first()).toEqual({ n: '0' });
      expect((await runRetroForks(w.db, 'apply')).changes).toHaveLength(2);
    });

    it('a second run is a NO-OP: nothing changes, no event, the outbox sequence does not move', async () => {
      await world();
      await runRetroForks(w.db, 'apply');
      const after = await dump(w.db);
      const again = await runRetroForks(w.db, 'apply');
      expect(again.changes).toEqual([]);
      expect(again.summary).toMatchObject({ candidateCopies: 0, forked: 0 });
      expect(await dump(w.db)).toBe(after);
    });

    it('leaves alone, with a reason: renamed copy, user-authored list, other pack, already a fork, the platform org\'s own list, legacy org id, provenance mismatch', async () => {
      const x = await world();
      const renamed = await w.insertList({ key: 'yes-no-custom', org: newOrg().wire, seed: seeded('yes-no') });
      const mine = await w.insertList({ key: 'yes-no', org: newOrg().wire }); // user authored, same key
      const otherPack = await w.insertList({ key: 'yes-no', org: newOrg().wire, seed: seeded('yes-no', 'some-other-pack') });
      const e = newOrg();
      const already = await w.insertList({ key: 'yes-no', org: e.wire, seed: seeded('yes-no'), forkedFrom: { listId: x.yes, orgId: PLATFORM.wire } });
      const platformOwn = await w.insertList({ key: 'platform-yes-no', org: PLATFORM.uuid, seed: seeded('yes-no'), visibility: 'org' }); // the platform org's own list (other rendering): never a candidate
      const legacy = await w.insertList({ key: 'yes-no', org: 'legacy-org-1', seed: seeded('yes-no') });
      const snapshot = await Promise.all([renamed, mine, otherPack, already, platformOwn, legacy].map(get));
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes.map((c) => c.listId).sort()).toEqual([x.copyA, x.copyB].sort());
      expect(await Promise.all([renamed, mine, otherPack, already, platformOwn, legacy].map(get))).toEqual(snapshot);
      const why = Object.fromEntries(report.skipped.map((s) => [s.listId, s.reason]));
      expect(why[renamed]).toContain('renamed copy');
      expect(why[otherPack]).toContain('provenance mismatch');
      expect(why[legacy]).toContain('unsupported-org-id');
      expect(why[mine]).toBeUndefined(); // not a copy: not even mentioned
      expect(why[platformOwn]).toBeUndefined(); // the platform org's own list: not a candidate
      expect(why[already]).toBeUndefined(); // already a fork: not a candidate
    });

    it('an organization that already holds a fork of the common list under the OTHER rendering keeps it: its copy is left alone', async () => {
      const x = await world();
      const dup = await w.insertList({ key: 'other-name', org: x.a.uuid, ageMin: 5, forkedFrom: { listId: x.yes, orgId: PLATFORM.wire } }); // a fork, bare-UUID rendering
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes.map((c) => c.listId)).toEqual([x.copyB]);
      expect(report.skipped.some((s) => s.listId === x.copyA && s.reason.includes('already holds a fork'))).toBe(true);
      expect((await get(x.copyA)).forked_from_list_id).toBeNull();
      expect((await get(dup)).forked_from_list_id).toBe(x.yes);
    });

    it('does not guess when an item code exists only on one side: unmatched copy items keep origin NULL, unmatched common items map nothing', async () => {
      const x = await world();
      await runRetroForks(w.db, 'apply');
      expect((await items(x.copyA)).find((i: any) => i.code === 'MAYBE').origin_item_id).toBeNull();
      expect((await items(x.copyA)).map((i: any) => i.code)).toEqual(['MAYBE', 'NO', 'YES']); // OLD (archived on the common list) was not invented
    });

    it('a copy with more than 5000 mappable items is left alone (the list.forked bound)', async () => {
      const x = await world();
      const bigCommon = await w.insertList({ key: 'big', org: PLATFORM.wire, visibility: 'platform', seed: seeded('big') });
      const org = newOrg();
      const bigCopy = await w.insertList({ key: 'big', org: org.wire, seed: seeded('big') });
      for (const list of [bigCommon, bigCopy]) {
        await w.db.raw(
          `INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by)
           SELECT 'front_sli_' || md5(? || g::text), ?, 'C' || g::text, g, 'active', 'x' FROM generate_series(1, 5001) g`,
          [list, list],
        );
      }
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes.map((c) => c.listId).sort()).toEqual([x.copyA, x.copyB].sort());
      expect(report.skipped.find((s) => s.listId === bigCopy)!.reason).toContain('5000');
      expect((await get(bigCopy)).forked_from_list_id).toBeNull();
    });
  });

  describe('preconditions (nothing is written)', () => {
    it('the platform organization must be configured AND confirmed by the projection', async () => {
      await world();
      const before = await dump(w.db);
      delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
      _resetPlatformOrgCacheForTesting();
      await expect(runRetroForks(w.db, 'apply')).rejects.toBeInstanceOf(RolloutPreconditionError);
      await expect(runRetroForks(w.db, 'dry-run')).rejects.toThrow(/platform organization is not resolved/);
      process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM.wire;
      await w.db('selection_list_ref_index').update({ org_type: 'organization' }); // the projection denies it
      _resetPlatformOrgCacheForTesting();
      await expect(runRetroForks(w.db, 'apply')).rejects.toBeInstanceOf(RolloutPreconditionError);
      expect(await dump(w.db)).toBe(before);
    });

    it('with no active common list yet it does nothing and says why', async () => {
      await w.insertList({ key: 'yes-no', org: newOrg().wire, seed: seeded('yes-no') });
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes).toEqual([]);
      expect(report.warnings.join(' ')).toContain('no active common (platform) list exists yet');
    });

    it('--apply refuses while duplicate groups exist (reconcile first); a dry run only warns; after reconcile it converts the winner', async () => {
      const x = await world();
      const o = newOrg();
      const older = await w.insertList({ key: 'yes-no', org: o.uuid, ageMin: 90, seed: seeded('yes-no') });
      await w.insertItem(older, 'YES');
      const younger = await w.insertList({ key: 'yes-no', org: o.wire, ageMin: 10, seed: seeded('yes-no') });
      const before = await dump(w.db);
      const dry = await runRetroForks(w.db, 'dry-run');
      expect(dry.warnings.join(' ')).toContain('duplicate group(s)');
      expect(dry.changes.map((c) => c.listId)).toContain(older); // only the winner of the pair is planned...
      expect(dry.changes.map((c) => c.listId)).not.toContain(younger);
      await expect(runRetroForks(w.db, 'apply')).rejects.toThrow(/run reconcile-duplicates first/);
      expect(await dump(w.db)).toBe(before);
      await runReconcileDuplicates(w.db, 'apply');
      const report = await runRetroForks(w.db, 'apply');
      expect(report.changes.map((c) => c.listId).sort()).toEqual([x.copyA, x.copyB, older].sort());
      expect((await get(older)).forked_from_list_id).toBe(x.yes);
      expect((await get(younger)).forked_from_list_id).toBeNull(); // the archived, renamed loser stays a plain list
      expect(report.skipped.some((s) => s.listId === younger && s.reason.includes('loser of reconcile-duplicates'))).toBe(true);
    });
  });

  describe('safe while the service is serving', () => {
    it('waits for the organization outbox lock of the copy\'s org; a copy a writer already made a fork meanwhile is left alone, no second event', async () => {
      const x = await world();
      const holder = await w.db.transaction();
      await lockOrgOutbox(holder, x.a.wire);
      let finished = false;
      const run = runRetroForks(w.db, 'apply').then((r) => {
        finished = true;
        return r;
      });
      await sleep(500);
      expect(finished).toBe(false);
      // what POST /fork or an operator does meanwhile
      await holder('selection_lists').where({ id: x.copyA }).update({ forked_from_list_id: x.yes, forked_from_org_id: PLATFORM.wire, forked_from_revision: 3, forked_at: new Date() });
      await holder.commit();
      const report = await run;
      expect(report.changes.map((c) => c.listId)).toEqual([x.copyB]);
      expect(report.skipped.some((s) => s.listId === x.copyA && s.reason.includes('changed since the plan'))).toBe(true);
      expect(await events(x.copyA)).toEqual([]);
      expect(Number((await get(x.copyA)).forked_from_revision)).toBe(3);
    });

    it('two runs at once convert and announce each copy exactly once', async () => {
      const x = await world();
      const [r1, r2] = await Promise.all([runRetroForks(w.db, 'apply'), runRetroForks(w.db, 'apply')]);
      expect(r1.changes.length + r2.changes.length).toBe(2);
      for (const id of [x.copyA, x.copyB]) expect(await events(id)).toHaveLength(1);
      expect(await w.db('selection_lists').whereNotNull('forked_from_list_id').count<{ n: string }>('* as n').first()).toEqual({ n: '2' });
    });
  });

  it('never reads a flag', async () => {
    await world();
    await runRetroForks(w.db, 'dry-run');
    await runRetroForks(w.db, 'apply');
    expect(flagReads).toEqual([]);
  });
});
