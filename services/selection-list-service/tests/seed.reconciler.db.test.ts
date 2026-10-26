// seed.reconciler.db.test.ts - the platform-seed reconciler / backfill (plan 7.1 step 6, 11).
//
// REAL Postgres + real migrations + the real seed library, outbox and flag helper (flags pinned through the
// service's flag client seam); only the per-org flag verdict / apply are wrapped where a test needs to inject a
// fault or a barrier. Covers: backfill of unseeded orgs, pack-version upgrade rollout, flag-OFF orgs skipped,
// deleted / inactive / excluded-type / unknown orgs never touched, per-org error isolation + backoff, two
// reconcilers racing (no duplicates), bounded batches (+ resume cursor, no starvation) and graceful stop.

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Knex } from 'knex';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { eventsAfter, maxSeq, orgId, projectOrg } from './helpers/seedFixtures';
import { FLAGS, setFlagClient } from '../src/flags';
import { loadPlatformPack, applyPlatformDefaults } from '../src/seed';
import {
  isReconcilerEnabled,
  loadReconcilerConfig,
  RECONCILER_DEFAULTS,
  ReconcilerBackoff,
  runReconcilerOnce,
  startReconciler,
} from '../src/seed/reconciler';
import {
  reconcilerFailedTotal,
  reconcilerOrgsSeededTotal,
  reconcilerSkippedFlagOffTotal,
  reconcilerSkippedOtherTotal,
} from '../src/lib/metrics';
import { createLogger } from '../src/lib/logger';

// ---- flags ----------------------------------------------------------------------------------
const flagState: { service: boolean; seed: boolean; off: Set<string> } = { service: true, seed: true, off: new Set() };
setFlagClient({
  getBooleanValue: async (key: string, _dflt: boolean, ctx?: { orgId?: string }) => {
    if (ctx?.orgId && flagState.off.has(ctx.orgId)) return false;
    return key === FLAGS.SELECTION_LISTS_SERVICE ? flagState.service : key === FLAGS.SELECTION_LISTS_SEED_DEFAULTS ? flagState.seed : false;
  },
});

const PACK = loadPlatformPack('platform-defaults', 1);
const PACK_LISTS = PACK.lists.length;
const PACK_ITEMS = PACK.lists.reduce((n, l) => n + l.items.length, 0);

/** A pack directory holding v1 (as shipped) and, optionally, a v2 that adds one item to the first list. */
function packDir(withV2: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-recon-packs-'));
  fs.writeFileSync(path.join(dir, 'platform-defaults.v1.json'), JSON.stringify(PACK));
  if (withV2) {
    const v2 = JSON.parse(JSON.stringify(PACK));
    v2.version = 2;
    v2.lists[0].items.push({ code: 'MAYBE', label: 'Maybe', translations: [] });
    fs.writeFileSync(path.join(dir, 'platform-defaults.v2.json'), JSON.stringify(v2));
  }
  return dir;
}

dbDescribe('seed reconciler (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let silent = createLogger('silent');

  beforeAll(async () => {
    t = await createTestDb(12);
    db = t.db;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await db.raw('TRUNCATE selection_list_ref_index, selection_list_seed_ledger, selection_lists, selection_list_org_quota, event_outbox CASCADE');
    flagState.service = true;
    flagState.seed = true;
    flagState.off = new Set();
    reconcilerOrgsSeededTotal.reset();
    reconcilerSkippedFlagOffTotal.reset();
    reconcilerSkippedOtherTotal.reset();
    reconcilerFailedTotal.reset();
  });

  const counter = async (c: { get: () => Promise<{ values: Array<{ value: number; labels: Record<string, unknown> }> }> }, labels?: Record<string, string>) => {
    const { values } = await c.get();
    return values.filter((v) => !labels || Object.entries(labels).every(([k, x]) => v.labels[k] === x)).reduce((n, v) => n + v.value, 0);
  };
  const run = (over: Parameters<typeof runReconcilerOnce>[1] = {}) => runReconcilerOnce(db, { batchDelayMs: 0, logger: silent, ...over });
  const ledger = (org: string) => db('selection_list_seed_ledger').where({ organization_id: org }).orderBy('version');
  const listsOf = (org: string) => db('selection_lists').where({ organization_id: org });
  const itemsOf = async (org: string) => Number((await db('selection_list_items as i').join('selection_lists as l', 'l.id', 'i.list_id').where('l.organization_id', org).count('* as n').first())!.n);
  const nOrgs = (n: number, from = 1) => Array.from({ length: n }, (_, i) => orgId(from + i));

  describe('backfill', () => {
    it('seeds active orgs the ledger has never seen (trigger=backfill), including personal; leaves the rows well-formed', async () => {
      const [a, b] = nOrgs(2);
      const p = orgId(3);
      await projectOrg(db, a);
      await projectOrg(db, b);
      await projectOrg(db, p, { type: 'personal' });

      const before = await maxSeq(db);
      const s = await run();
      expect(s).toMatchObject({ examined: 3, seeded: 3, failed: 0, skippedFlagOff: 0, nextCursor: null, stopped: false });

      for (const org of [a, b, p]) {
        expect(await listsOf(org)).toHaveLength(PACK_LISTS);
        expect(await itemsOf(org)).toBe(PACK_ITEMS);
        const l = await ledger(org);
        expect(l).toHaveLength(1);
        expect(l[0]).toMatchObject({ seed_source: 'platform', seed_key: 'platform-defaults', version: 1, trigger: 'backfill', request_id: null });
      }
      const ev = await eventsAfter(db, before);
      expect(ev.filter((e) => e.topic === 'selection-lists.seed.completed')).toHaveLength(3);
      expect(ev.filter((e) => e.topic === 'selection-lists.seed.completed').every((e) => e.payload.trigger === 'backfill' && e.payload.outcome === 'applied')).toBe(true);
      expect(await counter(reconcilerOrgsSeededTotal)).toBe(3);
    });

    it('is idempotent: a second run finds nothing to do and writes nothing', async () => {
      await Promise.all(nOrgs(3).map((o) => projectOrg(db, o)));
      await run();
      const seq = await maxSeq(db);
      const before = await ledger(orgId(1));
      const s = await run();
      expect(s).toMatchObject({ examined: 0, seeded: 0, nextCursor: null });
      expect(await maxSeq(db)).toBe(seq);
      expect(await ledger(orgId(1))).toEqual(before);
    });

    it('does not touch an org already seeded by org-created at the current version', async () => {
      const a = orgId(1);
      await projectOrg(db, a);
      await applyPlatformDefaults(db, a, { trigger: 'org-created' });
      const seq = await maxSeq(db);
      expect((await run()).examined).toBe(0);
      expect(await maxSeq(db)).toBe(seq);
      expect((await ledger(a))[0].trigger).toBe('org-created');
    });
  });

  describe('pack version rollout', () => {
    it('upgrades an org holding an older ledger version, leaves an up-to-date org alone', async () => {
      const [old, fresh, never] = nOrgs(3);
      for (const o of [old, fresh, never]) await projectOrg(db, o);
      const v1 = packDir(false);
      const v12 = packDir(true);
      await applyPlatformDefaults(db, old, { trigger: 'org-created', packDir: v1 });
      await applyPlatformDefaults(db, fresh, { trigger: 'org-created', packDir: v12 });
      expect((await ledger(fresh)).map((r) => r.version)).toEqual([2]);

      const s = await run({ packDir: v12 });
      expect(s).toMatchObject({ examined: 2, seeded: 2, failed: 0 });
      expect((await ledger(old)).map((r) => [r.version, r.trigger])).toEqual([[1, 'org-created'], [2, 'backfill']]);
      expect((await ledger(never)).map((r) => r.version)).toEqual([2]);
      expect((await ledger(fresh)).map((r) => r.version)).toEqual([2]);
      // the upgrade added the new item for the org that held v1
      expect(await itemsOf(old)).toBe(PACK_ITEMS + 1);
      expect((await eventsAfter(db)).some((e) => e.topic === 'selection-lists.seed.completed' && e.payload.outcome === 'upgraded')).toBe(true);
      // and a re-run is a no-op
      expect((await run({ packDir: v12 })).examined).toBe(0);
    });
  });

  describe('flag gating', () => {
    it('seeds nothing while seeding is OFF (seed flag, or the master gate) and counts skipped_flag_off; seeds once ON', async () => {
      await Promise.all(nOrgs(2).map((o) => projectOrg(db, o)));
      flagState.seed = false;
      let s = await run();
      expect(s).toMatchObject({ examined: 2, seeded: 0, skippedFlagOff: 2 });
      flagState.seed = true;
      flagState.service = false;
      s = await run();
      expect(s).toMatchObject({ examined: 2, seeded: 0, skippedFlagOff: 2 });
      expect(await db('selection_lists').count('* as n').first()).toMatchObject({ n: '0' });
      expect(await db('selection_list_seed_ledger').count('* as n').first()).toMatchObject({ n: '0' });
      expect(await db('event_outbox').count('* as n').first()).toMatchObject({ n: '0' });
      expect(await counter(reconcilerSkippedFlagOffTotal)).toBe(4);

      flagState.service = true; // the flag flips ON: the very same orgs are backfilled
      s = await run();
      expect(s).toMatchObject({ examined: 2, seeded: 2, skippedFlagOff: 0 });
    });

    it('evaluates the flag per org: only the orgs it is ON for are seeded', async () => {
      const [on, off] = nOrgs(2);
      await projectOrg(db, on);
      await projectOrg(db, off);
      flagState.off.add(off);
      const s = await run();
      expect(s).toMatchObject({ examined: 2, seeded: 1, skippedFlagOff: 1 });
      expect(await listsOf(on)).toHaveLength(PACK_LISTS);
      expect(await listsOf(off)).toHaveLength(0);
    });

    it('a flag evaluation that throws is isolated (fail closed): that org fails and backs off, the rest are seeded', async () => {
      const [a, b] = nOrgs(2);
      await projectOrg(db, a);
      await projectOrg(db, b);
      const s = await run({
        backoff: new ReconcilerBackoff(),
        isSeedingEnabled: async (org) => {
          if (org === a) throw new Error('unleash exploded');
          return true;
        },
      });
      expect(s).toMatchObject({ examined: 2, seeded: 1, failed: 1 });
      expect(await listsOf(a)).toHaveLength(0);
      expect(await listsOf(b)).toHaveLength(PACK_LISTS);
    });
  });

  describe('orgs it must never touch', () => {
    it('skips deleted tombstones, inactive orgs, the platform (root) org type and rows without a wire id - they are not even examined', async () => {
      const [ok, deleted, inactive, root, noWire] = nOrgs(5);
      await projectOrg(db, ok);
      await projectOrg(db, deleted, { status: 'deleted' });
      await projectOrg(db, inactive, { isActive: false });
      await projectOrg(db, root, { type: 'platform' });
      await projectOrg(db, noWire);
      await db('selection_list_ref_index').where({ wire_id: noWire }).update({ wire_id: null });
      // is_active unknown (NULL) is not "known active" -> not seeded either
      const unknown = orgId(6);
      await projectOrg(db, unknown);
      await db('selection_list_ref_index').where({ wire_id: unknown }).update({ is_active: null });

      const s = await run();
      expect(s).toMatchObject({ examined: 1, seeded: 1 });
      for (const o of [deleted, inactive, root, noWire, unknown]) {
        expect(await ledger(o)).toHaveLength(0);
        expect(await listsOf(o)).toHaveLength(0);
      }
      expect(await listsOf(ok)).toHaveLength(PACK_LISTS);
      // nothing in the outbox mentions a skipped org (no seed.failed for a deleted org either)
      expect((await eventsAfter(db)).filter((e) => [deleted, inactive, root].includes(e.payload.organizationId))).toHaveLength(0);
    });

    it('an org deleted or deactivated between the scan and the lock is re-checked under the lock and skipped', async () => {
      const [a, b] = nOrgs(2);
      await projectOrg(db, a);
      await projectOrg(db, b);
      const s = await run({
        isSeedingEnabled: async (org) => {
          if (org === a) await db('selection_list_ref_index').where({ wire_id: a }).update({ status: 'deleted' }); // mid-scan delete
          return true;
        },
      });
      expect(s).toMatchObject({ examined: 2, seeded: 1, skippedUpToDate: 1 });
      expect(await listsOf(a)).toHaveLength(0);
      expect(await ledger(a)).toHaveLength(0);
    });
  });

  describe('error isolation and backoff', () => {
    it('one org throwing never stops the sweep; it is backed off (no hot loop) and retried once the backoff elapses', async () => {
      const [a, b, c] = nOrgs(3);
      for (const o of [a, b, c]) await projectOrg(db, o);
      let clock = 1_000_000;
      const backoff = new ReconcilerBackoff(60_000, 3_600_000);
      let attemptsOnB = 0;
      const flaky = (healed: boolean) => async (d: Knex, org: string, o?: Parameters<typeof applyPlatformDefaults>[2]) => {
        if (org === b) {
          attemptsOnB += 1;
          if (!healed) throw new Error('connection reset');
        }
        return applyPlatformDefaults(d, org, o);
      };

      let s = await run({ backoff, now: () => clock, applyPlatformDefaults: flaky(false) });
      expect(s).toMatchObject({ examined: 3, seeded: 2, failed: 1 });
      expect(await listsOf(b)).toHaveLength(0);
      expect(await counter(reconcilerFailedTotal, { retryable: 'true' })).toBe(1);

      // next tick, still inside the backoff window: b is skipped without a call
      clock += 30_000;
      s = await run({ backoff, now: () => clock, applyPlatformDefaults: flaky(false) });
      expect(s).toMatchObject({ examined: 1, skippedBackoff: 1, failed: 0 });
      expect(attemptsOnB).toBe(1);

      // window elapsed, the fault persists: tried again, backoff doubles
      clock += 40_000;
      s = await run({ backoff, now: () => clock, applyPlatformDefaults: flaky(false) });
      expect(s.failed).toBe(1);
      expect(attemptsOnB).toBe(2);
      clock += 90_000; // < 120s doubled window
      expect((await run({ backoff, now: () => clock, applyPlatformDefaults: flaky(false) })).skippedBackoff).toBe(1);
      expect(attemptsOnB).toBe(2);

      // healed + window elapsed: seeded, backoff cleared
      clock += 60_000;
      s = await run({ backoff, now: () => clock, applyPlatformDefaults: flaky(true) });
      expect(s).toMatchObject({ examined: 1, seeded: 1 });
      expect(await listsOf(b)).toHaveLength(PACK_LISTS);
      expect(backoff.size).toBe(0);
    });

    it('a real retryable refusal (KEY_CONFLICT) is recorded as seed.failed and backed off; the other orgs are seeded', async () => {
      const [a, b] = nOrgs(2);
      await projectOrg(db, a);
      await projectOrg(db, b);
      await db('selection_lists').insert({ id: `front_sl_conflict${a.slice(-6)}`, organization_id: a, key: PACK.lists[0].key, created_by: 'usr_x' });
      const backoff = new ReconcilerBackoff();
      const s = await run({ backoff });
      expect(s).toMatchObject({ examined: 2, seeded: 1, failed: 1 });
      expect(await listsOf(b)).toHaveLength(PACK_LISTS);
      const failed = (await eventsAfter(db)).filter((e) => e.topic === 'selection-lists.seed.failed');
      expect(failed).toHaveLength(1);
      expect(failed[0].payload).toMatchObject({ reason: 'KEY_CONFLICT', retryable: true, trigger: 'backfill' });
      expect(backoff.isBlocked(a, Date.now())).toBe(true);
      // the next tick does NOT re-record seed.failed for it (backoff), and does not touch b again
      const seq = await maxSeq(db);
      expect(await run({ backoff })).toMatchObject({ examined: 1, skippedBackoff: 1 });
      expect(await maxSeq(db)).toBe(seq);
    });

    it('a NON-retryable refusal goes straight to the maximum backoff', async () => {
      const [a] = nOrgs(1);
      await projectOrg(db, a);
      const backoff = new ReconcilerBackoff(1_000, 3_600_000);
      const t0 = 5_000_000;
      const refuse = async (_d: Knex, org: string) => [
        {
          packKey: 'platform-defaults',
          version: 1,
          result: { status: 'failed' as const, reason: 'PACK_CONTENT_MISMATCH' as const, message: 'm', retryable: false, details: [], eventId: 'e', organizationId: org },
        },
      ];
      const s = await run({ backoff, now: () => t0, applyPlatformDefaults: refuse as never });
      expect(s.failed).toBe(1);
      expect(backoff.isBlocked(a, t0 + 3_599_000)).toBe(true);
      expect(backoff.isBlocked(a, t0 + 3_600_001)).toBe(false);
      expect(await counter(reconcilerFailedTotal, { retryable: 'false' })).toBe(1);
    });

    it('a candidate-scan failure surfaces to the caller (the scheduler logs it and carries on)', async () => {
      const broken = { raw: async () => { throw new Error('db down'); } } as unknown as Knex;
      await expect(runReconcilerOnce(broken, { logger: silent })).rejects.toThrow('db down');
    });
  });

  describe('multi-instance safety', () => {
    it('two reconcilers racing over the same orgs produce exactly one seed each - no duplicate lists, items, ledger rows or seed.completed', async () => {
      const orgs = nOrgs(8);
      for (const o of orgs) await projectOrg(db, o);
      // widen the race window: each apply takes a little while, so both instances reach every org together
      const slowApply: typeof applyPlatformDefaults = async (d, org, o) => {
        await new Promise((r) => setTimeout(r, 25));
        return applyPlatformDefaults(d, org, o);
      };
      const [s1, s2] = await Promise.all([run({ applyPlatformDefaults: slowApply, batchSize: 4 }), run({ applyPlatformDefaults: slowApply, batchSize: 4 })]);

      expect(s1.failed + s2.failed).toBe(0);
      expect(s1.seeded + s2.seeded).toBe(orgs.length); // every org seeded exactly once, by one of them
      for (const o of orgs) {
        expect(await ledger(o)).toHaveLength(1);
        expect(await listsOf(o)).toHaveLength(PACK_LISTS);
        expect(await itemsOf(o)).toBe(PACK_ITEMS);
      }
      const completed = (await eventsAfter(db)).filter((e) => e.topic === 'selection-lists.seed.completed');
      expect(completed).toHaveLength(orgs.length);
      // the loser of each org skipped (locked, or already done once it got the lock)
      expect(s1.skippedLocked + s2.skippedLocked + s1.skippedUpToDate + s2.skippedUpToDate).toBe(s1.examined + s2.examined - orgs.length);
    });

    it('an org whose lock another instance holds is skipped (not queued, not seeded twice)', async () => {
      const [a] = nOrgs(1);
      await projectOrg(db, a);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      const tx = db.transaction(async (trx) => {
        await trx.raw(`SELECT pg_advisory_xact_lock(hashtextextended('sl-reconciler:' || current_schema() || ':' || ?, 0))`, [a]);
        locked();
        await gate;
      });
      await hasLock;
      const s = await run();
      expect(s).toMatchObject({ examined: 1, seeded: 0, skippedLocked: 1, failed: 0 });
      expect(await listsOf(a)).toHaveLength(0);
      release();
      await tx;
      expect(await run()).toMatchObject({ seeded: 1 });
    });
  });

  describe('bounded work', () => {
    it('examines at most maxOrgsPerTick orgs, pages by batchSize with a pause between pages, and resumes from the cursor', async () => {
      const orgs = nOrgs(7);
      for (const o of orgs) await projectOrg(db, o);
      const pauses: number[] = [];
      const base = { batchSize: 2, batchDelayMs: 50, maxOrgsPerTick: 5, sleep: async (ms: number) => void pauses.push(ms) };

      let s = await run(base);
      expect(s).toMatchObject({ examined: 5, seeded: 5, stopped: false });
      expect(s.nextCursor).not.toBeNull();
      expect(pauses).toEqual([50, 50]); // 3 pages (2+2+1) -> a pause between pages, none after the last
      expect((await db('selection_list_seed_ledger').count('* as n').first())!.n).toBe('5');

      s = await run({ ...base, cursor: s.nextCursor });
      expect(s).toMatchObject({ examined: 2, seeded: 2, nextCursor: null }); // list exhausted -> sweep complete
      expect((await db('selection_list_seed_ledger').count('* as n').first())!.n).toBe('7');
    });

    it('flag-OFF orgs count toward the cap but the cursor keeps the sweep moving - later orgs are not starved', async () => {
      const orgs = nOrgs(6);
      for (const o of orgs) await projectOrg(db, o);
      for (const o of orgs.slice(0, 3)) flagState.off.add(o); // the first three sort first
      const opts = { batchSize: 2, maxOrgsPerTick: 3 };
      let s = await run(opts);
      expect(s).toMatchObject({ examined: 3, skippedFlagOff: 3, seeded: 0 });
      s = await run({ ...opts, cursor: s.nextCursor });
      expect(s).toMatchObject({ examined: 3, seeded: 3 });
      for (const o of orgs.slice(3)) expect(await ledger(o)).toHaveLength(1);
    });
  });

  describe('scheduler', () => {
    it('runs on its own, seeds, and stop() is graceful and idempotent', async () => {
      const a = orgId(1);
      await projectOrg(db, a);
      const h = startReconciler({ db, logger: silent, initialDelayMs: 0, config: { intervalMs: 1_000, batchDelayMs: 0 } });
      await h.runNow(); // serialised behind (or instead of) the scheduled tick
      expect(await ledger(a)).toHaveLength(1);
      await h.stop();
      await h.stop();
    });

    it('stop() waits for the in-flight org, then no further org is started and no further tick is scheduled', async () => {
      const orgs = nOrgs(4);
      for (const o of orgs) await projectOrg(db, o);
      const started: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inApply = new Promise<void>((r) => (entered = r));
      const gated: typeof applyPlatformDefaults = async (d, org, o) => {
        started.push(org);
        entered();
        await gate;
        return applyPlatformDefaults(d, org, o);
      };
      const h = startReconciler({
        db,
        logger: silent,
        initialDelayMs: 0,
        config: { intervalMs: 1_000, batchSize: 1, batchDelayMs: 0 },
        run: { applyPlatformDefaults: gated },
      });
      await inApply; // the first org is mid-apply
      let stopped = false;
      const stopping = h.stop().then(() => (stopped = true));
      await new Promise((r) => setTimeout(r, 100));
      expect(stopped).toBe(false); // waits for the in-flight org
      release();
      await stopping;
      expect(started).toHaveLength(1); // never began a second org
      expect(await ledger(started[0])).toHaveLength(1); // the in-flight org completed cleanly
      await new Promise((r) => setTimeout(r, 1_200)); // interval passes: nothing is scheduled any more
      expect(started).toHaveLength(1);
      expect((await db('selection_list_seed_ledger').count('* as n').first())!.n).toBe('1');
    });

    it('stop() before the first tick prevents it', async () => {
      await projectOrg(db, orgId(1));
      const h = startReconciler({ db, logger: silent, initialDelayMs: 200, config: { intervalMs: 1_000 } });
      await h.stop();
      await new Promise((r) => setTimeout(r, 400));
      expect(await ledger(orgId(1))).toHaveLength(0);
    });
  });

  describe('logs', () => {
    it('log lines carry the org id and never the seed content', async () => {
      const lines: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Writable } = require('stream');
      const log = createLogger('debug', new Writable({ write(c: Buffer, _e: string, cb: () => void) { lines.push(c.toString()); cb(); } }));
      const [a] = nOrgs(1);
      await projectOrg(db, a);
      await runReconcilerOnce(db, { batchDelayMs: 0, logger: log });
      const text = lines.join('');
      expect(text).toContain(a);
      expect(text).toContain('platform defaults backfilled');
      expect(text).not.toContain(PACK.lists[0].items[0].label);
    });
  });
});

describe('reconciler config (no database)', () => {
  const log = createLogger('silent');

  it('is OFF unless SEED_RECONCILER_ENABLED is exactly "true"', () => {
    expect(isReconcilerEnabled({})).toBe(false);
    expect(isReconcilerEnabled({ SEED_RECONCILER_ENABLED: 'false' })).toBe(false);
    expect(isReconcilerEnabled({ SEED_RECONCILER_ENABLED: '1' })).toBe(false);
    expect(isReconcilerEnabled({ SEED_RECONCILER_ENABLED: 'true' })).toBe(true);
  });

  it('uses safe defaults, reads valid overrides, and falls back on garbage / out-of-range values', () => {
    expect(loadReconcilerConfig({}, log)).toEqual(RECONCILER_DEFAULTS);
    expect(
      loadReconcilerConfig(
        { SEED_RECONCILER_INTERVAL_MS: '60000', SEED_RECONCILER_BATCH_SIZE: '5', SEED_RECONCILER_BATCH_DELAY_MS: '0', SEED_RECONCILER_MAX_ORGS_PER_TICK: '50', SEED_RECONCILER_BACKOFF_BASE_MS: '2000', SEED_RECONCILER_BACKOFF_MAX_MS: '9000' },
        log,
      ),
    ).toEqual({ intervalMs: 60000, batchSize: 5, batchDelayMs: 0, maxOrgsPerTick: 50, backoffBaseMs: 2000, backoffMaxMs: 9000 });
    expect(loadReconcilerConfig({ SEED_RECONCILER_BATCH_SIZE: 'abc', SEED_RECONCILER_INTERVAL_MS: '5', SEED_RECONCILER_MAX_ORGS_PER_TICK: '-1', SEED_RECONCILER_BATCH_DELAY_MS: '1.5' }, log)).toEqual(RECONCILER_DEFAULTS);
  });

  it('backoff doubles per consecutive failure up to the cap, and a success forgets the org', () => {
    const b = new ReconcilerBackoff(1_000, 8_000);
    const delays = [1, 2, 3, 4, 5].map(() => b.fail('org_a', 0));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
    expect(b.isBlocked('org_a', 7_999)).toBe(true);
    expect(b.isBlocked('org_a', 8_000)).toBe(false);
    b.succeed('org_a');
    expect(b.size).toBe(0);
    expect(b.fail('org_a', 0)).toBe(1_000);
    expect(b.fail('org_b', 0, true)).toBe(8_000);
  });
});
