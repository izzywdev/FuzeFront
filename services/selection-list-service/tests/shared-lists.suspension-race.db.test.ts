// shared-lists.suspension-race.db.test.ts - a platform-org deactivation recorded BETWEEN a mutation's request-level
// suspension check and its transaction must still refuse that mutation.
//
// The request-level gate (`requireListMutation`) reads the suspension once, long before the mutating transaction
// commits. The deactivation recording (events/platformGuard.ts) and every mutating transaction therefore share the
// ONE org outbox lock, and every mutating transaction re-reads the suspension (fresh) after taking it
// (`assertPlatformWritable`). The interleaving is FORCED, not hoped for (like shared-lists.purge-race): the test
// holds the org lock in its own transaction, fires the mutation (it passes the request-level gate - nothing is
// suspended yet - and parks on that very lock), waits until it is verifiably waiting, records the REAL deactivation
// inside the holder, commits, and asserts the mutation was refused with nothing written and no event queued.
//
// Covered: list PATCH / archive / restore / DELETE (archive and purge), publish and promote INTO the platform org,
// items (create / patch / reorder / archive / delete / purge), list and item translations (put / delete / autofill),
// access PUT / DELETE, and platform seeding. Flag ON and flag OFF (the gate is flag-independent).

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, P, PLATFORM, World } from './helpers/sharedWorld';
import { allFlagsExceptShared, flagClientWith } from './helpers/flagClient';
import { spec } from './helpers/seedFixtures';
import { ATTEMPT_NAMES, Ctx, fingerprint as fp, freshCommonList, mutationAttempts } from './helpers/suspensionFixtures';
import { logger } from '../src/lib/logger';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const PLATFORM_UUID = toUuid(PLATFORM as never);

dbDescribe('a deactivation recorded between the request-level check and the transaction still refuses the mutation (real Postgres)', () => {
  let w: World;
  let n = 0;

  beforeAll(async () => {
    w = await createWorld(state);
    w.authz.member(PLATFORM, P.opEditor.userId); // the membership probe of access PUT
  });
  afterAll(() => w.teardown());
  beforeEach(async () => {
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ suspended_at: null, suspended_event_at: null, snapshot_at: null });
  });
  afterEach(async () => {
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ suspended_at: null, suspended_event_at: null, snapshot_at: null });
  });

  const useFlags = async (shared: boolean) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(shared ? flagClientWith(true) : { getBooleanValue: allFlagsExceptShared });
  };

  /**
   * How many sessions wait on the org outbox advisory lock of `org`. Advisory locks are database-wide and the suites
   * share one database (a schema each), so a waiter from another suite can be counted: callers compare with the
   * count taken BEFORE they fired their own request.
   */
  const waitersOn = async (org: string): Promise<number> => {
    const r = await w.db.raw(
      `SELECT count(*)::int AS c FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND ((classid::bigint << 32) | objid::bigint) = (SELECT hashtextextended(?, 0))`,
      [`sl-outbox:${org}`],
    );
    return r.rows[0].c as number;
  };
  /** Wait until ONE MORE session than `base` is parked on the platform org's lock (our own request). */
  const parked = async (base: number) => {
    for (let i = 0; i < 200 && (await waitersOn(PLATFORM)) <= base; i++) await new Promise((r) => setTimeout(r, 25));
    expect(await waitersOn(PLATFORM)).toBeGreaterThan(base);
  };

  const deactivate = async (ex: Knex | Knex.Transaction) => {
    const { recordPlatformDeactivation } = await import('../src/events/platformGuard');
    return recordPlatformDeactivation(
      ex,
      PLATFORM_UUID,
      { topic: 'identity.org.deleted', correlationId: `corr-race-${++n}`, occurredAt: new Date(Date.now() - 2000).toISOString() },
      logger,
      { cascade: 'soft' },
    );
  };

  /**
   * Run `request` while `during` lands (inside the lock holder) between the request's pre-transaction checks and
   * its transaction. The request is verifiably parked on the org lock when `during` runs.
   */
  const raced = async <T>(request: () => PromiseLike<T>, during: (trx: Knex.Transaction) => Promise<unknown>): Promise<T> => {
    const { lockOrgOutbox } = await import('../src/events/outbox');
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const haveLock = new Promise<void>((r) => (locked = r));
    const holder = w.db.transaction(async (trx) => {
      await lockOrgOutbox(trx, PLATFORM);
      locked();
      await holding;
      await during(trx);
    });
    await haveLock;
    const base = await waitersOn(PLATFORM);
    const pending = Promise.resolve(request());
    try {
      await parked(base);
    } catch (err) {
      // never leave the holder transaction open (nor its effects racing the next test) if the request did not park
      release();
      await holder.catch(() => undefined);
      const answered = (await pending.catch((e: unknown) => e)) as { status?: number; body?: unknown };
      throw new Error(`the request did not park on the org lock; it answered ${answered?.status} ${JSON.stringify(answered?.body)} (${(err as Error).message})`);
    }
    release();
    await holder;
    return pending;
  };

  /** A fresh common list (flag ON, platform org active), then the flags the race runs under. */
  const fresh = async (): Promise<Ctx> => {
    await useFlags(true);
    return freshCommonList(w, `race-${++n}`);
  };
  const fingerprint = (id: string) => fp(w.db, id);
  /** The suite makes dozens of lists as one operator: keep them out of the per-user list quota (20). */
  const outOfQuota = (id: string) => w.db('selection_lists').where({ id }).update({ created_by: 'system' });

  describe.each([
    ['flag ON', true],
    ['shared-lists flag OFF', false],
  ] as Array<[string, boolean]>)('%s', (_name, shared) => {
    afterAll(() => useFlags(true));

    it.each(ATTEMPT_NAMES)('%s: refused (403 platform_suspended), nothing written, no event queued', async (name) => {
      const run = mutationAttempts(w).find((a) => a[0] === name)![1];
      const c = await fresh();
      if (name === 'DELETE access') {
        // give the user a live grant first, so a DELETE would have something to revoke
        expect((await w.api(P.op).put(`${c.L}/access/${P.opEditor.userId}`, { role: 'list-editor' })).status).toBe(200);
      }
      await w.newEvents();
      const before = await fingerprint(c.id);
      await useFlags(shared);
      const res = await raced(() => run(c), (trx) => deactivate(trx));
      expect({ name, status: res.status, reason: res.body?.reason }).toEqual({ name, status: 403, reason: 'platform_suspended' });
      expect(await fingerprint(c.id)).toBe(before); // rolled back completely
      expect(await w.newEvents()).toEqual([]); // no event queued
    });

    it('control: the same race WITHOUT a deactivation lets the mutation through (the harness really parks it)', async () => {
      const c = await fresh();
      await useFlags(shared);
      const res = await raced(() => w.api(P.op).patch(c.L, { description: 'goes through' }), async () => undefined);
      expect(res.status).toBe(200);
    });
  });

  it('publishing a NEW common list (flag ON): refused when the platform org is deactivated while it waits, nothing created', async () => {
    await useFlags(true);
    const before = Number(((await w.db('selection_lists').count('id as c').first()) as { c: string }).c);
    const res = await raced(() => w.api(P.op).post('/v1/selection-lists', { key: `pub-race-${++n}`, name: 'P', visibility: 'platform' }), (trx) => deactivate(trx));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('platform_suspended');
    expect(Number(((await w.db('selection_lists').count('id as c').first()) as { c: string }).c)).toBe(before);
  });

  it('promoting a private list of the platform org INTO the common set: refused when the org is deactivated while it waits', async () => {
    await useFlags(true);
    const mine = await w.api(P.op).post('/v1/selection-lists', { key: `promote-race-${++n}`, name: 'M' });
    expect(mine.status).toBe(201);
    await outOfQuota(mine.body.id);
    const res = await raced(() => w.api(P.op).patch(`/v1/selection-lists/${mine.body.id}`, { visibility: 'platform' }), (trx) => deactivate(trx));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('platform_suspended');
    expect((await w.db('selection_lists').where({ id: mine.body.id }).first()).visibility).toBe('private');
  });

  it('the in-transaction re-check is keyed by the row OWNER too: with SELECTION_LIST_PLATFORM_ORG_ID removed the raced edit is still refused', async () => {
    const c = await fresh();
    const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    const before = await fingerprint(c.id);
    delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    _resetPlatformOrgCacheForTesting();
    try {
      const res = await raced(() => w.api(P.op).patch(c.L, { description: 'x' }), (trx) => deactivate(trx));
      expect({ status: res.status, reason: res.body?.reason }).toEqual({ status: 403, reason: 'platform_suspended' });
      expect(await fingerprint(c.id)).toBe(before); // nothing written, no event queued
    } finally {
      process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM;
      _resetPlatformOrgCacheForTesting();
    }
  });

  it('a PRIVATE list of the platform org is not a platform write: the same race lets its edit through', async () => {
    await useFlags(true);
    const mine = await w.api(P.op).post('/v1/selection-lists', { key: `private-race-${++n}`, name: 'M' });
    await outOfQuota(mine.body.id);
    const res = await raced(() => w.api(P.op).patch(`/v1/selection-lists/${mine.body.id}`, { description: 'fine' }), (trx) => deactivate(trx));
    expect(res.status).toBe(200);
  });

  it('platform SEEDING: a deactivation recorded while the seed waits for the org lock refuses it (retryable), nothing written', async () => {
    await useFlags(true);
    const { applySeedRequest } = await import('../src/seed');
    const req = (key: string, lists: unknown[]) =>
      ({
        organizationId: PLATFORM,
        scope: 'org',
        source: { app: 'platform', service: 'selection-list-service' },
        pack: { key, version: 1 },
        trigger: 'org-created',
        requestId: null,
        honorVisibility: true,
        lists,
      }) as never;
    for (const [label, lists] of [
      ['a common list', [spec('seed-race-common', ['A'], { visibility: 'platform' })]],
      ['a private list (the org owns common rows, so every rewrite of its lists is a platform write)', [spec('seed-race-private', ['A'])]],
    ] as Array<[string, unknown[]]>) {
      const key = `race-pack-${++n}`;
      const res: any = await raced(() => applySeedRequest(w.db, req(key, lists)), (trx) => deactivate(trx));
      expect({ label, status: res.status, retryable: res.retryable }).toEqual({ label, status: 'failed', retryable: true });
      expect(await w.db('selection_lists').whereIn('key', ['seed-race-common', 'seed-race-private'])).toHaveLength(0);
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ suspended_at: null, suspended_event_at: null, snapshot_at: null });
    }
  });

  describe('the deactivation / reactivation recording takes the SAME org lock', () => {
    it('recordPlatformDeactivation parks behind a held org lock and records only after it is released', async () => {
      const { lockOrgOutbox } = await import('../src/events/outbox');
      let release!: () => void;
      const holding = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const haveLock = new Promise<void>((r) => (locked = r));
      const holder = w.db.transaction(async (trx) => {
        await lockOrgOutbox(trx, PLATFORM);
        locked();
        await holding;
      });
      await haveLock;
      const base = await waitersOn(PLATFORM);
      const recording = deactivate(w.db);
      const read = async () => (await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first()).suspended_at;
      try {
        await parked(base);
        expect(await read()).toBeNull(); // parked: not recorded yet
      } finally {
        release(); // a failing assertion must not leave the holder transaction (and the teardown) hanging
      }
      await holder;
      expect(await recording).toBe('suspended');
      expect(await read()).not.toBeNull();
    });

    it('the resume path parks behind a held org lock too, and a mutation that held it before the resume still saw the suspension', async () => {
      await deactivate(w.db);
      const { resumeIfReactivated } = await import('../src/events/platformGuard');
      const { lockOrgOutbox } = await import('../src/events/outbox');
      let release!: () => void;
      const holding = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const haveLock = new Promise<void>((r) => (locked = r));
      const holder = w.db.transaction(async (trx) => {
        await lockOrgOutbox(trx, PLATFORM);
        locked();
        await holding;
      });
      await haveLock;
      const base = await waitersOn(PLATFORM);
      const resuming = resumeIfReactivated(w.db, { organizationId: PLATFORM_UUID, type: 'platform', isActive: true }, { topic: 'identity.org.updated', correlationId: 'corr-resume', occurredAt: new Date().toISOString() }, logger);
      const read = async () => (await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first()).suspended_at;
      try {
        await parked(base);
        expect(await read()).not.toBeNull(); // still suspended while the resume waits
      } finally {
        release();
      }
      await holder;
      await resuming;
      expect(await read()).toBeNull();
    });

    it('a mutation that wins the lock BEFORE the deactivation is legitimate: the deactivation then waits for it and the list keeps the edit', async () => {
      await useFlags(true);
      const c = await fresh();
      // the mutation commits first; the deactivation recorded afterwards changes nothing already committed
      expect((await w.api(P.op).patch(c.L, { description: 'before suspension' })).status).toBe(200);
      await deactivate(w.db);
      expect((await w.api(P.op).patch(c.L, { description: 'after suspension' })).status).toBe(403);
      expect((await w.api(P.op).get(c.L)).body.description).toBe('before suspension');
    });
  });
});
