// rollout.duplicates.db.test.ts - the pre-flag-ON duplicate audit and its reconciliation on REAL Postgres with the real
// migrations (runbook docs/runbooks/selection-lists-rollout.md sections 10.1 and 10.2).
//
// Covered: dry run writes nothing (and cannot: it runs READ ONLY); apply fixes duplicates under BOTH orderings of the two
// renderings (the older one wins whichever rendering it is stored under); a re-run is a no-op and the audit and the
// runbook's own SQL (A, B) then return 0 rows; the audit agrees with the runbook SQL; archived/active mix; duplicate
// forks; legacy ids that are neither a UUID nor a TypeID; a common list is never auto-archived; the rename target
// being taken; the events through the outbox; safety against a concurrent writer (the org outbox lock) and against a
// second job run; the SQL ordering and the winner function agree; and the flag is never read.

import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { createRolloutWorld, dump, expectDryRunAgreesWithApply, orgPair, RolloutWorld, uuidOf } from './helpers/rolloutWorld';
import { lockOrgOutbox } from '../src/events/outbox';
import { pickWinner, renderingWinnerOrder } from '../src/lib/renderingWinner';
import { dupKey, loadAllLists, runAudit, runReconcileDuplicates } from '../src/rollout/duplicates';
import { exitCodeFor, withReadOnly } from '../src/rollout/common';
import { dbDescribe } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));
// The jobs are FLAG-INDEPENDENT: any read of a flag in this file is a failure.
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

const runbook = fs.readFileSync(path.join(__dirname, '../../../docs/runbooks/selection-lists-rollout.md'), 'utf8');
const sqlBlocks = [...runbook.slice(runbook.indexOf('### 10.1')).matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const queryA = sqlBlocks[0].slice(sqlBlocks[0].indexOf('WITH rows AS'), sqlBlocks[0].indexOf('-- B.'));
const queryB = sqlBlocks[0].slice(sqlBlocks[0].indexOf('-- B.'), sqlBlocks[0].indexOf('-- C.'));
const queryC = sqlBlocks[0].slice(sqlBlocks[0].indexOf('-- C.'));
const fallbackSql = sqlBlocks[1];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

dbDescribe('rollout: duplicate audit + reconcile (real Postgres)', () => {
  let w: RolloutWorld;
  let seq = 0;
  const newOrg = () => orgPair(++seq);

  beforeAll(async () => {
    w = await createRolloutWorld(state);
  });
  afterAll(() => w.teardown());
  beforeEach(async () => {
    await w.db.raw(
      'TRUNCATE selection_lists, selection_list_items, selection_list_translations, selection_list_item_translations, event_outbox, selection_list_ref_index, selection_list_access RESTART IDENTITY CASCADE',
    );
    flagReads.length = 0;
  });
  afterEach(() => expect(flagReads).toEqual([]));

  const rowsOf = (ids: string[]) => w.db('selection_lists').whereIn('id', ids).orderBy('id');
  const eventsOf = async (listId: string) => (await w.db('event_outbox').whereRaw(`payload->>'listId' = ?`, [listId]).orderBy('seq')).map((r: any) => ({ topic: r.topic, p: r.payload, org: r.organization_id, corr: r.correlation_id }));
  const aRows = async () => (await w.db.raw(queryA)).rows as Array<{ org_uuid: string; key: string; rows: string; ids_winner_first: string[]; stored_as: string[] }>;
  const bRows = async () => (await w.db.raw(queryB)).rows as Array<{ org_uuid: string; forked_from_list_id: string; fork_ids_winner_first: string[] }>;

  /** An org with `key` stored under BOTH renderings; `uuidIsOlder` decides which rendering holds the older (winning) row. */
  async function duplicate(key: string, uuidIsOlder: boolean, over: { loserStatus?: 'active' | 'archived'; winnerStatus?: 'active' | 'archived' } = {}) {
    const org = newOrg();
    await w.projectOrg(org);
    const older = await w.insertList({ key, org: uuidIsOlder ? org.uuid : org.wire, ageMin: 100, status: over.winnerStatus ?? 'active', seed: { source: 'platform', key: 'platform-defaults', listKey: key } });
    const younger = await w.insertList({ key, org: uuidIsOlder ? org.wire : org.uuid, ageMin: 10, status: over.loserStatus ?? 'active' });
    await w.insertItem(older, 'YES');
    await w.insertItem(younger, 'YES');
    return { org, winner: older, loser: younger };
  }

  describe('audit (read-only)', () => {
    it('finds the same key under both renderings, in either order, and agrees with the runbook SQL query A', async () => {
      const x = await duplicate('yes-no', true);
      const y = await duplicate('priority', false);
      await w.insertList({ key: 'clean', org: newOrg().uuid }); // not a duplicate
      const report = await runAudit(w.db);
      expect(report.summary).toMatchObject({ keyDuplicateGroups: 2, forkDuplicateGroups: 0 });
      const detail = (o: { org: { wire: string } }) => report.blocked.find((b) => b.organizationId === o.org.wire)!.detail as any;
      expect(detail(x).idsWinnerFirst).toEqual([x.winner, x.loser]);
      expect(detail(y).idsWinnerFirst).toEqual([y.winner, y.loser]);
      expect(detail(x).storedAs).toEqual([x.org.uuid, x.org.wire]);
      expect(exitCodeFor(report)).toBe(2);
      // the runbook's SQL (which pairs through the org projection) finds exactly the same groups, winner first
      const sql = await aRows();
      expect(sql.map((r) => [r.org_uuid, r.key, r.ids_winner_first])).toEqual(
        [[x.org.uuid, 'yes-no', [x.winner, x.loser]], [y.org.uuid, 'priority', [y.winner, y.loser]]].sort((a: any, b: any) => (a[0] < b[0] ? -1 : 1)),
      );
    });

    it('finds duplicate forks (query B) only when more than one is ACTIVE', async () => {
      const org = newOrg();
      const other = newOrg();
      await w.projectOrg(org);
      await w.projectOrg(other);
      const common = await w.insertList({ key: 'yes-no', org: orgPair(0xf00).wire, visibility: 'platform' });
      const fork = (o: string, key: string, status: 'active' | 'archived', age: number) =>
        w.insertList({ key, org: o, status, ageMin: age, forkedFrom: { listId: common, orgId: orgPair(0xf00).wire } });
      const f1 = await fork(org.uuid, 'one', 'active', 50);
      const f2 = await fork(org.wire, 'two', 'active', 20);
      await fork(other.uuid, 'one', 'archived', 50); // archived + active: not ambiguous
      await fork(other.wire, 'two', 'active', 20);
      const report = await runAudit(w.db);
      expect(report.summary).toMatchObject({ keyDuplicateGroups: 0, forkDuplicateGroups: 1 });
      expect((report.blocked[0].detail as any).idsWinnerFirst).toEqual([f1, f2]);
      expect((await bRows()).map((r) => r.fork_ids_winner_first)).toEqual([[f1, f2]]);
    });

    it('reports legacy ids that are neither a UUID nor a TypeID, pairs nothing with them, and does not fail on them', async () => {
      await w.insertList({ key: 'a', org: 'legacy-org-1' });
      await w.insertList({ key: 'b', org: 'legacy-org-1' });
      const report = await runAudit(w.db);
      expect(report.summary).toMatchObject({ keyDuplicateGroups: 0, forkDuplicateGroups: 0, unrecognisedOrgIds: 1 });
      expect(report.skipped[0].organizationId).toBe('legacy-org-1');
      expect(exitCodeFor(report)).toBe(0);
      // query C is the SQL twin of that report
      expect((await w.db.raw(queryC)).rows.map((r: any) => r.organization_id)).toContain('legacy-org-1');
    });

    it('pairs organizations that are NOT in the projection (the codec does what the SQL cannot)', async () => {
      const org = newOrg(); // deliberately not projected
      const a = await w.insertList({ key: 'x', org: org.uuid, ageMin: 9 });
      const b = await w.insertList({ key: 'x', org: org.wire, ageMin: 1 });
      const report = await runAudit(w.db);
      expect((report.blocked[0].detail as any).idsWinnerFirst).toEqual([a, b]);
      expect(await aRows()).toEqual([]); // the SQL needs the projection: that is query C's whole point
      expect((await w.db.raw(queryC)).rows.map((r: any) => r.organization_id)).toEqual(expect.arrayContaining([org.uuid, org.wire]));
    });

    it('writes nothing: it runs in a READ ONLY transaction, and Postgres refuses a write there', async () => {
      await duplicate('yes-no', true);
      const before = await dump(w.db);
      await runAudit(w.db);
      expect(await dump(w.db)).toBe(before);
      await expect(withReadOnly(w.db, (trx) => trx('selection_lists').update({ status: 'archived' }))).rejects.toMatchObject({ code: '25006' });
    });
  });

  describe('reconcile --dry-run', () => {
    it('prints the plan and WRITES NOTHING (rows, outbox rows and the outbox sequence are untouched)', async () => {
      await duplicate('yes-no', true);
      await duplicate('priority', false, { loserStatus: 'archived' });
      const before = await dump(w.db);
      const report = await runReconcileDuplicates(w.db, 'dry-run');
      expect(report.mode).toBe('dry-run');
      expect(report.changes).toHaveLength(2);
      expect(report.summary).toMatchObject({ keyDuplicateGroups: 2, wouldRenameAndArchive: 2, blocked: 0 });
      expect(await dump(w.db)).toBe(before);
    });
  });

  describe('reconcile --apply', () => {
    it.each([
      ['the bare-UUID row is older and wins', true],
      ['the TypeID row is older and wins', false],
    ])('%s: the winner is untouched, the loser is renamed + archived, nothing is deleted, ids are kept', async (_n, uuidIsOlder) => {
      const x = await duplicate('yes-no', uuidIsOlder);
      const [winnerBefore] = await rowsOf([x.winner]);
      const itemsBefore = await w.db('selection_list_items').count<{ n: string }>('* as n').first();
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.changes).toHaveLength(1);
      expect(report.changes[0]).toMatchObject({ listId: x.loser, action: 'rename+archive (key duplicate)', detail: { from: 'yes-no', to: dupKey('yes-no', x.loser), winner: x.winner } });
      const [winner] = await rowsOf([x.winner]);
      expect(winner).toEqual(winnerBefore); // byte for byte: not even updated_at moved
      const [loser] = await rowsOf([x.loser]);
      expect(loser).toMatchObject({ key: dupKey('yes-no', x.loser), status: 'archived', organization_id: uuidIsOlder ? x.org.wire : x.org.uuid });
      expect(await w.db('selection_lists').count<{ n: string }>('* as n').first()).toEqual({ n: '2' });
      expect(await w.db('selection_list_items').count<{ n: string }>('* as n').first()).toEqual(itemsBefore);
      expect(await w.db('selection_list_translations').where({ list_id: x.loser }).count<{ n: string }>('* as n').first()).toEqual({ n: '1' });
      expect(exitCodeFor(report)).toBe(0);
    });

    it('then a second run is a NO-OP, the audit is clean, and the runbook SQL (A and B) returns 0 rows', async () => {
      await duplicate('yes-no', true);
      await duplicate('priority', false);
      await runReconcileDuplicates(w.db, 'apply');
      const afterFirst = await dump(w.db);
      const again = await runReconcileDuplicates(w.db, 'apply');
      expect(again.changes).toEqual([]);
      expect(again.summary).toMatchObject({ keyDuplicateGroups: 0, renamedAndArchived: 0 });
      expect(await dump(w.db)).toBe(afterFirst);
      const audit = await runAudit(w.db);
      expect(audit.summary).toMatchObject({ keyDuplicateGroups: 0, forkDuplicateGroups: 0 });
      expect(exitCodeFor(audit)).toBe(0);
      expect(await aRows()).toEqual([]);
      expect(await bRows()).toEqual([]);
    });

    it('enqueues list.updated (previousKey) and list.archived for an active loser, in the same transaction, keyed by the org', async () => {
      const x = await duplicate('yes-no', true);
      const report = await runReconcileDuplicates(w.db, 'apply');
      const ev = await eventsOf(x.loser);
      expect(ev.map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED, TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
      expect(ev[0].p).toMatchObject({ listId: x.loser, listKey: dupKey('yes-no', x.loser), previousKey: 'yes-no', changedFields: ['key'], organizationId: x.org.wire });
      expect(ev[0].p.actor).toEqual({ type: 'system', principal: 'selection-list-service', seedSource: null });
      expect(ev[1].p.list).toMatchObject({ status: 'archived', key: dupKey('yes-no', x.loser) });
      expect(ev[1].p.listRevision).toBe(ev[0].p.listRevision + 1);
      expect(ev.every((e) => e.org === x.org.wire && e.corr === `rollout:reconcile-duplicates:${report.runId}`)).toBe(true);
      expect(await eventsOf(x.winner)).toEqual([]); // the winner emits nothing
    });

    it('archived/active mix: the ACTIVE row wins even if younger; an already-archived loser is only renamed (no list.archived)', async () => {
      const org = newOrg();
      const archivedOld = await w.insertList({ key: 'mix', org: org.uuid, ageMin: 500, status: 'archived' });
      const activeNew = await w.insertList({ key: 'mix', org: org.wire, ageMin: 1, status: 'active' });
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.changes.map((c) => c.listId)).toEqual([archivedOld]);
      expect((await rowsOf([activeNew]))[0]).toMatchObject({ key: 'mix', status: 'active' });
      expect((await rowsOf([archivedOld]))[0]).toMatchObject({ key: dupKey('mix', archivedOld), status: 'archived' });
      expect((await eventsOf(archivedOld)).map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    });

    it('both archived: still one winner (the oldest); the other is renamed', async () => {
      const org = newOrg();
      const a = await w.insertList({ key: 'both', org: org.wire, ageMin: 90, status: 'archived' });
      const b = await w.insertList({ key: 'both', org: org.uuid, ageMin: 30, status: 'archived' });
      await runReconcileDuplicates(w.db, 'apply');
      expect((await rowsOf([a]))[0].key).toBe('both');
      expect((await rowsOf([b]))[0].key).toBe(dupKey('both', b));
    });

    it('three renderings-worth of rows (UUID, TypeID, UPPERCASE UUID): one winner, two losers', async () => {
      const org = newOrg();
      const a = await w.insertList({ key: 'tri', org: org.uuid, ageMin: 30 });
      const b = await w.insertList({ key: 'tri', org: org.wire, ageMin: 20 });
      const c = await w.insertList({ key: 'tri', org: org.uuid.toUpperCase(), ageMin: 10 });
      await runReconcileDuplicates(w.db, 'apply');
      expect((await rowsOf([a]))[0].key).toBe('tri');
      expect((await rowsOf([b, c])).map((r: any) => r.key).sort()).toEqual([dupKey('tri', b), dupKey('tri', c)].sort());
      expect((await runAudit(w.db)).summary.keyDuplicateGroups).toBe(0);
    });

    it('duplicate FORKS under two renderings (different keys): the oldest active fork wins, provenance of the loser is kept', async () => {
      const org = newOrg();
      const platform = orgPair(0xf00);
      const common = await w.insertList({ key: 'yes-no', org: platform.wire, visibility: 'platform' });
      const fk = (o: string, key: string, age: number) => w.insertList({ key, org: o, ageMin: age, forkedFrom: { listId: common, orgId: platform.wire } });
      const f1 = await fk(org.uuid, 'one', 50);
      const f2 = await fk(org.wire, 'two', 20);
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.changes.map((c) => c.listId)).toEqual([f2]);
      expect(report.changes[0].action).toBe('rename+archive (fork duplicate)');
      expect((await rowsOf([f1]))[0]).toMatchObject({ key: 'one', status: 'active' });
      expect((await rowsOf([f2]))[0]).toMatchObject({ key: dupKey('two', f2), status: 'archived', forked_from_list_id: common });
      expect(await bRows()).toEqual([]);
      expect((await runAudit(w.db)).summary).toMatchObject({ forkDuplicateGroups: 0, keyDuplicateGroups: 0 });
    });

    it('duplicate forks that also share a key are settled by the key phase alone (no double handling)', async () => {
      const org = newOrg();
      const platform = orgPair(0xf00);
      const common = await w.insertList({ key: 'yes-no', org: platform.wire, visibility: 'platform' });
      const fk = (o: string, age: number) => w.insertList({ key: 'yes-no', org: o, ageMin: age, forkedFrom: { listId: common, orgId: platform.wire } });
      const f1 = await fk(org.uuid, 50);
      const f2 = await fk(org.wire, 20);
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.changes.map((c) => c.listId)).toEqual([f2]);
      expect(report.changes[0].action).toBe('rename+archive (key duplicate)');
      expect((await eventsOf(f1))).toEqual([]);
      expect(await bRows()).toEqual([]);
    });

    it('legacy ids (neither UUID nor TypeID) are never touched, even beside real duplicates', async () => {
      await w.insertList({ key: 'a', org: 'legacy-org-1' });
      await w.insertList({ key: 'b', org: 'Legacy_Org_1' });
      await duplicate('yes-no', true);
      const legacyBefore = await w.db('selection_lists').whereIn('organization_id', ['legacy-org-1', 'Legacy_Org_1']).orderBy('id');
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.changes).toHaveLength(1);
      expect(report.skipped.map((s) => s.organizationId).sort()).toEqual(['Legacy_Org_1', 'legacy-org-1']);
      expect(await w.db('selection_lists').whereIn('organization_id', ['legacy-org-1', 'Legacy_Org_1']).orderBy('id')).toEqual(legacyBefore);
    });

    it('a COMMON (platform) list is never auto-archived: reported BLOCKED, nothing written, exit code 2', async () => {
      const org = newOrg();
      const keep = await w.insertList({ key: 'common', org: org.uuid, ageMin: 100, visibility: 'org' });
      const common = await w.insertList({ key: 'common', org: org.wire, ageMin: 10, visibility: 'platform' });
      const before = await dump(w.db);
      const dry = await runReconcileDuplicates(w.db, 'dry-run');
      expect(dry.blocked.map((b) => b.listId)).toEqual([common]);
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.changes).toEqual([]);
      expect(report.blocked.map((b) => b.listId)).toEqual([common]);
      expect(exitCodeFor(report)).toBe(2);
      expect(await dump(w.db)).toBe(before);
      expect((await rowsOf([keep]))[0].key).toBe('common');
    });

    it('a rename target that is already taken blocks that group (rolled back whole) and the others still reconcile', async () => {
      const bad = await duplicate('taken', true);
      const good = await duplicate('fine', true);
      await w.insertList({ key: dupKey('taken', bad.loser), org: bad.org.wire }); // squats the target name (the loser is stored under wire)
      const report = await runReconcileDuplicates(w.db, 'apply');
      expect(report.blocked).toHaveLength(1);
      expect(report.blocked[0]).toMatchObject({ organizationId: bad.org.wire, reason: expect.stringContaining('already taken') });
      expect((await rowsOf([bad.loser]))[0]).toMatchObject({ key: 'taken', status: 'active' });
      expect((await eventsOf(bad.loser))).toEqual([]);
      expect((await rowsOf([good.loser]))[0].status).toBe('archived');
    });

    it('DRY RUN AGREES WITH APPLY on messy data (common loser, squatted target, invalid key, empty name, two losers in one group)', async () => {
      const good = await duplicate('good', true);
      const taken = await duplicate('taken', true);
      await w.insertList({ key: dupKey('taken', taken.loser), org: taken.org.wire }); // squats the target name
      const org1 = newOrg();
      await w.insertList({ key: 'common', org: org1.uuid, ageMin: 100 });
      const common = await w.insertList({ key: 'common', org: org1.wire, ageMin: 5, visibility: 'platform' });
      const org2 = newOrg();
      await w.insertList({ key: 'k', org: org2.uuid, ageMin: 100 }); // a 1-char key: its list.updated event would be refused
      const badKey = await w.insertList({ key: 'k', org: org2.wire, ageMin: 5 });
      const org3 = newOrg();
      await w.insertList({ key: 'nm', org: org3.uuid, ageMin: 100 });
      const noName = await w.insertList({ key: 'nm', org: org3.wire, ageMin: 5 });
      await w.db('selection_list_translations').where({ list_id: noName }).update({ name: '' });
      const org4 = newOrg();
      await w.insertList({ key: 'tri', org: org4.uuid, ageMin: 100 });
      const t2 = await w.insertList({ key: 'tri', org: org4.wire, ageMin: 50 });
      const t3 = await w.insertList({ key: 'tri', org: org4.uuid.toUpperCase(), ageMin: 5 });
      const dry = await runReconcileDuplicates(w.db, 'dry-run');
      expect(dry.changes.map((c) => c.listId).sort()).toEqual([good.loser, t2, t3].sort());
      expect(dry.blocked.map((b) => b.listId).sort()).toEqual([taken.loser, common, badKey, noName].sort());
      const applied = await runReconcileDuplicates(w.db, 'apply');
      expectDryRunAgreesWithApply(dry, applied);
    });

    it('a 64-character key still yields a legal key, and the runbook fallback UPDATE produces the identical name', async () => {
      const key = `${'k'.repeat(60)}-abc`;
      expect(key).toHaveLength(64);
      const x = await duplicate(key, true);
      await runReconcileDuplicates(w.db, 'apply');
      const renamed = (await rowsOf([x.loser]))[0].key as string;
      expect(renamed.length).toBeLessThanOrEqual(64);
      expect(renamed).toMatch(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/);
      // the runbook's fallback statement, run on a second identical duplicate, gives the same name as the job
      const y = await duplicate(key, false);
      await w.db.raw(fallbackSql.replace("IN ('<loser id>', '<loser id>')", `IN ('${y.loser}')`));
      expect((await rowsOf([y.loser]))[0].key).toBe(dupKey(key, y.loser));
    });

    it('seeded losers: seed_user_modified is refreshed like a PATCH would (the rename is a content change for the seed hash)', async () => {
      const org = newOrg();
      await w.insertList({ key: 'seeded', org: org.uuid, ageMin: 100 });
      const loser = await w.insertList({ key: 'seeded', org: org.wire, ageMin: 10, seed: { source: 'platform', key: 'platform-defaults', listKey: 'seeded' } });
      await runReconcileDuplicates(w.db, 'apply');
      const r = (await rowsOf([loser]))[0];
      expect(r.seed_source).toBe('platform'); // provenance kept
      expect(r.seed_user_modified).toBe(true);
    });
  });

  describe('safe while the service is serving', () => {
    it('waits for the organization outbox lock a writer holds, then proceeds', async () => {
      const x = await duplicate('yes-no', true);
      const holder = await w.db.transaction();
      await lockOrgOutbox(holder, x.org.wire);
      let finished = false;
      const run = runReconcileDuplicates(w.db, 'apply').then((r) => {
        finished = true;
        return r;
      });
      await sleep(500);
      expect(finished).toBe(false);
      expect((await rowsOf([x.loser]))[0].status).toBe('active'); // nothing happened while the lock was held
      await holder.commit();
      const report = await run;
      expect(report.changes).toHaveLength(1);
      expect((await rowsOf([x.loser]))[0].status).toBe('archived');
    });

    it('re-decides under the lock: a concurrent writer that already renamed + archived the loser makes the group a no-op (no second change, no event)', async () => {
      const x = await duplicate('yes-no', true);
      const holder = await w.db.transaction();
      await lockOrgOutbox(holder, x.org.wire);
      const run = runReconcileDuplicates(w.db, 'apply');
      await sleep(300);
      await holder('selection_lists').where({ id: x.loser }).update({ key: 'renamed-by-hand', status: 'archived' }); // what a PATCH would do
      await holder.commit();
      const report = await run;
      expect(report.changes).toEqual([]);
      expect((await rowsOf([x.loser]))[0]).toMatchObject({ key: 'renamed-by-hand', status: 'archived' });
      expect(await eventsOf(x.loser)).toEqual([]);
    });

    it('two job runs at once: every loser is handled exactly once (no duplicate events)', async () => {
      const xs = [];
      for (let i = 0; i < 5; i++) xs.push(await duplicate(`k${i}`, i % 2 === 0));
      const [r1, r2] = await Promise.all([runReconcileDuplicates(w.db, 'apply'), runReconcileDuplicates(w.db, 'apply')]);
      expect(r1.changes.length + r2.changes.length).toBe(5);
      for (const x of xs) expect((await eventsOf(x.loser)).map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED, TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
      expect((await runAudit(w.db)).summary.keyDuplicateGroups).toBe(0);
    });

    it('events of one organization are in commit order (seq) and each listRevision only goes up', async () => {
      const org = newOrg();
      const a = await w.insertList({ key: 'one', org: org.uuid, ageMin: 100 });
      const b = await w.insertList({ key: 'one', org: org.wire, ageMin: 90 });
      const c = await w.insertList({ key: 'two', org: org.uuid, ageMin: 100 });
      const d = await w.insertList({ key: 'two', org: org.wire, ageMin: 90 });
      await runReconcileDuplicates(w.db, 'apply');
      const ev = await w.db('event_outbox').where({ organization_id: org.wire }).orderBy('seq');
      expect(ev).toHaveLength(4);
      expect(ev.every((e: any) => e.status === 'pending')).toBe(true);
      for (const id of [b, d]) {
        const revs = (await eventsOf(id)).map((e) => e.p.listRevision);
        expect(revs).toEqual([...revs].sort((x, y) => x - y));
        expect(new Set(revs).size).toBe(revs.length);
      }
      expect([a, c]).toHaveLength(2);
    });
  });

  describe('one winner rule', () => {
    it('the SQL ordering the service uses (renderingWinnerOrder) and the function the job uses (pickWinner) pick the same row, ties included', async () => {
      const when = new Date('2026-01-01T00:00:00.000Z');
      for (let round = 0; round < 25; round++) {
        await w.db.raw('TRUNCATE selection_lists, selection_list_translations RESTART IDENTITY CASCADE');
        const org = newOrg();
        const ids: string[] = [];
        for (const [i, r] of [org.uuid, org.wire, org.uuid.toUpperCase()].entries()) {
          const age = [0, 0, 5, 9][(round + i) % 4]; // collisions on purpose: ties must fall to the smallest id
          ids.push(await w.insertList({ key: 'k', org: r, status: (round + i) % 3 === 0 ? 'archived' : 'active', ageMin: age, id: `front_sl_zz${round}${i}` }));
          await w.db('selection_lists').where({ id: ids[i] }).update({ created_at: new Date(when.getTime() - age * 60_000) });
        }
        const fragment = renderingWinnerOrder('', '');
        const sqlFirst = (await w.db.raw(`SELECT id FROM selection_lists WHERE key = 'k' ORDER BY ${fragment.sql}`, fragment.params)).rows[0].id;
        const rows = await loadAllLists(w.db);
        expect(pickWinner(rows, '')!.id).toBe(sqlFirst);
      }
    });
  });

  describe('flag independence', () => {
    it('never reads a flag (the afterEach above fails the test if any flag was read)', async () => {
      await duplicate('yes-no', true);
      await runAudit(w.db);
      await runReconcileDuplicates(w.db, 'dry-run');
      await runReconcileDuplicates(w.db, 'apply');
      expect(flagReads).toEqual([]);
    });
  });

  it('(sanity) uuidOf / fromUuid round trip used by the fixtures', () => {
    const o = orgPair(1);
    expect(fromUuid('organization', uuidOf(o.wire))).toBe(o.wire);
  });
});
