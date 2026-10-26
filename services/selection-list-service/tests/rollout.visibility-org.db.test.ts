// rollout.visibility-org.db.test.ts - design record 9.4 on REAL Postgres: every SEEDED list that is still `private` becomes
// `org`. Dry run writes nothing; apply emits selection-lists.visibility.changed through the outbox; a re-run is a no-op;
// a user's deliberate choice is respected; legacy organization ids are skipped, not fatal; large organizations cross the
// chunk boundary; safe against a writer holding the organization outbox lock and against a second run; flag-independent.

import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { mintEventId, lockOrgOutbox } from '../src/events/outbox';
import { createRolloutWorld, dump, expectDryRunAgreesWithApply, orgPair, RolloutWorld, runbookSql } from './helpers/rolloutWorld';
import { dbDescribe } from './helpers/testDb';
import { runVisibilityOrg, VISIBILITY_CHUNK } from '../src/rollout/visibilityOrg';
import { exitCodeFor } from '../src/rollout/common';

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
const seeded = (listKey: string, source = PACK.source, key = PACK.key) => ({ source, key, listKey });

dbDescribe('rollout: visibility-org (design record 9.4) on real Postgres', () => {
  let w: RolloutWorld;
  let seq = 100;
  const newOrg = () => orgPair(++seq);

  beforeAll(async () => {
    w = await createRolloutWorld(state);
  });
  afterAll(() => w.teardown());
  beforeEach(async () => {
    await w.db.raw('TRUNCATE selection_lists, selection_list_items, selection_list_translations, selection_list_item_translations, event_outbox, selection_list_ref_index, selection_list_access, selection_list_rollout_marks RESTART IDENTITY CASCADE');
    flagReads.length = 0;
  });
  afterEach(() => expect(flagReads).toEqual([]));

  const get = (id: string) => w.db('selection_lists').where({ id }).first();
  const events = async (listId: string) => (await w.db('event_outbox').whereRaw(`payload->>'listId' = ?`, [listId]).orderBy('seq')).map((r: any) => ({ topic: r.topic, p: r.payload, org: r.organization_id, corr: r.correlation_id }));

  /** One of everything the job must (not) touch. */
  async function world() {
    const a = newOrg();
    const b = newOrg();
    const ids = {
      platformPack: await w.insertList({ key: 'yes-no', org: a.wire, seed: seeded('yes-no') }),
      appPack: await w.insertList({ key: 'crm-stages', org: a.uuid, seed: seeded('crm-stages', 'fuzecrm', 'crm-defaults') }), // bare-UUID rendering
      archivedSeeded: await w.insertList({ key: 'old', org: b.wire, status: 'archived', seed: seeded('old') }),
      userAuthored: await w.insertList({ key: 'mine', org: a.wire }), // private, NOT seeded
      alreadyOrg: await w.insertList({ key: 'ready', org: b.wire, visibility: 'org', seed: seeded('ready') }),
      common: await w.insertList({ key: 'common', org: orgPair(0xf00).wire, visibility: 'platform', seed: seeded('common') }),
    };
    return { a, b, ids };
  }

  it('dry run: names exactly the seeded private lists and WRITES NOTHING (rows, outbox, outbox sequence)', async () => {
    const x = await world();
    const before = await dump(w.db);
    const report = await runVisibilityOrg(w.db, 'dry-run');
    expect(await dump(w.db)).toBe(before);
    expect(report.mode).toBe('dry-run');
    expect(report.changes.map((c) => c.listId).sort()).toEqual([x.ids.platformPack, x.ids.appPack, x.ids.archivedSeeded].sort());
    expect(report.changes[0].action).toBe('visibility private -> org');
    expect(report.summary).toMatchObject({ seededListsTotal: 5, seededPrivateAtStart: 3, seededOrgAtStart: 1, seededPlatformAtStart: 1, wouldChange: 3, leftAlone: 0 });
  });

  it('apply: seeded private lists (any source, any status, either id rendering) become org; nothing else changes', async () => {
    const x = await world();
    const others = {
      userAuthored: await get(x.ids.userAuthored),
      alreadyOrg: await get(x.ids.alreadyOrg),
      common: await get(x.ids.common),
    };
    const report = await runVisibilityOrg(w.db, 'apply');
    expect(report.changes).toHaveLength(3);
    for (const id of [x.ids.platformPack, x.ids.appPack, x.ids.archivedSeeded]) expect((await get(id)).visibility).toBe('org');
    // untouched, byte for byte (not even updated_at)
    expect(await get(x.ids.userAuthored)).toEqual(others.userAuthored);
    expect(await get(x.ids.alreadyOrg)).toEqual(others.alreadyOrg);
    expect(await get(x.ids.common)).toEqual(others.common);
    expect((await get(x.ids.userAuthored)).visibility).toBe('private');
    // everything else of a changed list is preserved (key, status, seed provenance, ids)
    expect(await get(x.ids.archivedSeeded)).toMatchObject({ key: 'old', status: 'archived', seed_source: 'platform', seed_list_key: 'old' });
  });

  it('apply: one selection-lists.visibility.changed per list, in the SAME outbox, system actor, previous private, revision bumped once', async () => {
    const x = await world();
    const before = await get(x.ids.platformPack);
    const report = await runVisibilityOrg(w.db, 'apply');
    const ev = await events(x.ids.platformPack);
    expect(ev).toHaveLength(1);
    expect(ev[0].topic).toBe(TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED);
    expect(ev[0].p).toMatchObject({
      listId: x.ids.platformPack,
      listKey: 'yes-no',
      previousVisibility: 'private',
      visibility: 'org',
      organizationId: x.a.wire,
      actor: { type: 'system', principal: 'selection-list-service', seedSource: null },
      list: { visibility: 'org' },
    });
    expect(ev[0].p.listRevision).toBe(Number(before.revision) + 1);
    expect(Number((await get(x.ids.platformPack)).revision)).toBe(Number(before.revision) + 1);
    expect(ev[0].org).toBe(x.a.wire);
    expect(ev[0].corr).toBe(`rollout:visibility-org:${report.runId}`);
    // the bare-UUID-rendered list is announced under its org's wire id
    expect((await events(x.ids.appPack))[0].org).toBe(x.a.wire);
    // no event for the lists that did not change
    for (const id of [x.ids.userAuthored, x.ids.alreadyOrg, x.ids.common]) expect(await events(id)).toEqual([]);
  });

  it('a second run is a NO-OP (nothing changes, no event, the outbox sequence does not move)', async () => {
    await world();
    await runVisibilityOrg(w.db, 'apply');
    const after = await dump(w.db);
    const again = await runVisibilityOrg(w.db, 'apply');
    expect(again.changes).toEqual([]);
    expect(again.summary).toMatchObject({ seededPrivateAtStart: 0, changed: 0 });
    expect(await dump(w.db)).toBe(after);
    expect((await runVisibilityOrg(w.db, 'dry-run')).changes).toEqual([]);
  });

  it('respects a deliberate choice: a seeded list a USER set private (visibility.changed by a user) is left alone; a system event is not a choice', async () => {
    const o = newOrg();
    const chosen = await w.insertList({ key: 'chosen', org: o.wire, seed: seeded('chosen') });
    const rolled = await w.insertList({ key: 'rolled', org: o.wire, seed: seeded('rolled') });
    const outbox = (listId: string, actor: object) =>
      w.db('event_outbox').insert({
        id: mintEventId(),
        organization_id: o.wire,
        topic: TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED,
        payload: JSON.stringify({ listId, actor }),
        correlation_id: 'x',
        status: 'sent',
        sent_at: new Date(),
      });
    await outbox(chosen, { type: 'user', userId: 'usr_x' });
    await outbox(rolled, { type: 'system', principal: 'selection-list-service', seedSource: null });
    const dry = await runVisibilityOrg(w.db, 'dry-run');
    expect(dry.changes.map((c) => c.listId)).toEqual([rolled]);
    expect(dry.skipped).toHaveLength(1);
    expect(dry.skipped[0]).toMatchObject({ listId: chosen, reason: expect.stringContaining('on purpose') });
    await runVisibilityOrg(w.db, 'apply');
    expect((await get(chosen)).visibility).toBe('private');
    expect((await get(rolled)).visibility).toBe('org');
  });

  it('legacy organization ids (no org_ TypeID form) are skipped with a reason and never fatal', async () => {
    const legacy = await w.insertList({ key: 'legacy', org: 'legacy-org-1', seed: seeded('legacy') });
    const fine = await w.insertList({ key: 'fine', org: newOrg().wire, seed: seeded('fine') });
    const report = await runVisibilityOrg(w.db, 'apply');
    expect(report.changes.map((c) => c.listId)).toEqual([fine]);
    expect(report.skipped).toEqual([expect.objectContaining({ listId: legacy, reason: expect.stringContaining('unsupported-org-id') })]);
    expect((await get(legacy)).visibility).toBe('private');
    expect(await events(legacy)).toEqual([]);
  });

  it('a list whose event the contract refuses (legacy one-character key) is BLOCKED and left private; its neighbours in the same chunk still convert', async () => {
    const o = newOrg();
    const bad = await w.insertList({ key: 'k', org: o.wire, seed: seeded('k') }); // a 1-char key is not a legal SelectionListKey
    const good1 = await w.insertList({ key: 'good-one', org: o.wire, seed: seeded('good-one') });
    const good2 = await w.insertList({ key: 'good-two', org: o.uuid, seed: seeded('good-two') });
    const dry = await runVisibilityOrg(w.db, 'dry-run'); // the dry run already says so
    expect(dry.changes.map((c) => c.listId).sort()).toEqual([good1, good2].sort());
    expect(dry.blocked.map((b) => b.listId)).toEqual([bad]);
    const report = await runVisibilityOrg(w.db, 'apply');
    expect(report.changes.map((c) => c.listId).sort()).toEqual([good1, good2].sort());
    expect(report.blocked).toEqual([expect.objectContaining({ listId: bad, reason: expect.stringContaining('event contract') })]);
    expect((await get(bad)).visibility).toBe('private');
    expect(await events(bad)).toEqual([]);
    expect(exitCodeFor(report)).toBe(2);
    // the org is marked done, so a re-run does not touch it again: the blocked list is reported as LEFT ALONE (org done)
    // until an operator fixes the data and clears the marker on purpose (runbook 10.4)
    const again = await runVisibilityOrg(w.db, 'apply');
    expect(again.changes).toEqual([]);
    expect(again.skipped.map((s) => s.listId)).toEqual([bad]);
  });

  it('crosses the chunk boundary: an organization with more lists than one transaction takes is converted completely, once each', async () => {
    const o = newOrg();
    const n = VISIBILITY_CHUNK + 5;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await w.insertList({ key: `bulk-${String(i).padStart(4, '0')}`, org: o.wire, seed: seeded(`bulk-${i}`) }));
    const report = await runVisibilityOrg(w.db, 'apply');
    expect(report.changes).toHaveLength(n);
    expect(await w.db('selection_lists').where({ visibility: 'org' }).count<{ n: string }>('* as n').first()).toEqual({ n: String(n) });
    expect(await w.db('event_outbox').where({ topic: TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED }).count<{ n: string }>('* as n').first()).toEqual({ n: String(n) });
    expect((await runVisibilityOrg(w.db, 'apply')).changes).toEqual([]);
  });

  it('waits for the organization outbox lock a writer holds; a list the writer already made org meanwhile is not changed (or announced) again', async () => {
    const o = newOrg();
    const raced = await w.insertList({ key: 'raced', org: o.wire, seed: seeded('raced') });
    const plain = await w.insertList({ key: 'plain', org: o.wire, seed: seeded('plain') });
    const holder = await w.db.transaction();
    await lockOrgOutbox(holder, o.wire);
    let finished = false;
    const run = runVisibilityOrg(w.db, 'apply').then((r) => {
      finished = true;
      return r;
    });
    await sleep(400);
    expect(finished).toBe(false);
    await holder('selection_lists').where({ id: raced }).update({ visibility: 'org' }); // what a PATCH would do
    await holder.commit();
    const report = await run;
    expect(report.changes.map((c) => c.listId)).toEqual([plain]);
    expect(await events(raced)).toEqual([]);
    expect((await events(plain)).map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
  });

  it('two runs at once announce each list exactly once', async () => {
    const o = newOrg();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await w.insertList({ key: `c-${i}`, org: i % 2 ? o.uuid : o.wire, seed: seeded(`c-${i}`) }));
    const [r1, r2] = await Promise.all([runVisibilityOrg(w.db, 'apply'), runVisibilityOrg(w.db, 'apply')]);
    expect(r1.changes.length + r2.changes.length).toBe(6);
    for (const id of ids) expect(await events(id)).toHaveLength(1);
  });

  it('DRY RUN AGREES WITH APPLY on messy data (invalid key, empty name, legacy org, a deliberate choice): same changes, skips, blocked reasons, counters', async () => {
    const x = await world();
    const o = newOrg();
    const badKey = await w.insertList({ key: 'k', org: o.wire, seed: seeded('k') });
    const noName = await w.insertList({ key: 'no-name', org: o.wire, seed: seeded('no-name') });
    await w.db('selection_list_translations').where({ list_id: noName }).update({ name: '' }); // the event contract wants a non-empty name
    await w.insertList({ key: 'legacy', org: 'legacy-org-1', seed: seeded('legacy') });
    const chosen = await w.insertList({ key: 'chosen', org: o.wire, seed: seeded('chosen') });
    await w.db('event_outbox').insert({
      id: mintEventId(), organization_id: o.wire, topic: TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED,
      payload: JSON.stringify({ listId: chosen, actor: { type: 'user', userId: 'usr_x' } }), correlation_id: 'x', status: 'sent', sent_at: new Date(),
    });
    const dry = await runVisibilityOrg(w.db, 'dry-run');
    expect(dry.blocked.map((b) => b.listId).sort()).toEqual([badKey, noName].sort());
    const applied = await runVisibilityOrg(w.db, 'apply');
    expectDryRunAgreesWithApply(dry, applied);
    expect(applied.changes.map((c) => c.listId).sort()).toEqual([x.ids.platformPack, x.ids.appPack, x.ids.archivedSeeded].sort());
  });

  it('the runbook ROLLBACK statement puts exactly one run\'s lists back to private and touches nothing else', async () => {
    const x = await world();
    const other = await w.insertList({ key: 'already', org: x.a.wire, visibility: 'org', seed: seeded('already') });
    const report = await runVisibilityOrg(w.db, 'apply');
    expect(report.changes).toHaveLength(3);
    const stmt = runbookSql('-- ROLLBACK visibility-org').replace(/<runId>/g, report.runId);
    await w.db.raw(stmt);
    for (const id of [x.ids.platformPack, x.ids.appPack, x.ids.archivedSeeded]) expect((await get(id)).visibility).toBe('private');
    expect((await get(other)).visibility).toBe('org'); // not part of the run
    expect((await get(x.ids.alreadyOrg)).visibility).toBe('org');
    expect((await get(x.ids.common)).visibility).toBe('platform');
    // the rollback leaves the marks, so the job does NOT redo it behind the operator's back
    expect((await runVisibilityOrg(w.db, 'apply')).changes).toEqual([]);
    for (const id of [x.ids.platformPack, x.ids.appPack, x.ids.archivedSeeded]) expect((await get(id)).visibility).toBe('private');
  });

  it('never reads a flag', async () => {
    await world();
    await runVisibilityOrg(w.db, 'dry-run');
    await runVisibilityOrg(w.db, 'apply');
    expect(flagReads).toEqual([]);
  });
});
