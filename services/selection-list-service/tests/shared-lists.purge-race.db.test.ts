// shared-lists.purge-race.db.test.ts - the irreversible purge of a list / an item must not be authorized from a
// stale read. The pre-transaction guard (`requirePublishForPlatformList`) sees a PRIVATE list and waits for
// nothing; a promotion to `platform` (which holds the same org outbox lock) can then land before the purge takes
// the lock. The purge must re-check the LOCKED row and refuse a caller without `publish_platform`.
//
// The interleaving is FORCED, not hoped for: the test holds the org outbox lock in its own transaction, fires the
// purge (it passes the middleware read of a private list and then blocks on that very lock), waits until it is
// verifiably waiting on it, promotes the list inside the holder transaction and commits.
//
// The purge is the only mutation whose authorization depends on the list's CURRENT visibility; archive,
// restore, item/translation edits and access changes are decided by the instance role alone, so a concurrent
// promotion changes nothing for them (the "no race" block pins archive).

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { createWorld, P, PLATFORM, Principal, World } from './helpers/sharedWorld';
import { allFlagsExceptShared } from './helpers/flagClient';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('purge re-checks the locked list (real Postgres)', () => {
  let w: World;
  let n = 0;

  beforeAll(async () => {
    w = await createWorld(state);
  });
  afterAll(() => w.teardown());

  /** Is some session waiting on the org outbox advisory lock of `org`? */
  const waitingOnOrgLock = async (org: string): Promise<boolean> => {
    const r = await w.db.raw(
      `SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND ((classid::bigint << 32) | objid::bigint) = (SELECT hashtextextended(?, 0))`,
      [`sl-outbox:${org}`],
    );
    return r.rows.length > 0;
  };

  /**
   * Run `request` while `promote` lands between its pre-transaction read and its purge transaction.
   */
  const raced = async <T>(request: () => PromiseLike<T>, promote: (trx: Knex.Transaction) => Promise<void>): Promise<T> => {
    const { lockOrgOutbox } = await import('../src/events/outbox');
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const haveLock = new Promise<void>((r) => (locked = r));
    const holder = w.db.transaction(async (trx) => {
      await lockOrgOutbox(trx, PLATFORM);
      locked();
      await holding;
      await promote(trx);
    });
    await haveLock;
    const pending = Promise.resolve(request());
    for (let i = 0; i < 200 && !(await waitingOnOrgLock(PLATFORM)); i++) await new Promise((r) => setTimeout(r, 25));
    expect(await waitingOnOrgLock(PLATFORM)).toBe(true); // the purge has read the list (private) and is parked on the lock
    release();
    await holder;
    return pending;
  };

  const privateListWithItem = async (key: string) => {
    const made = await w.api(P.op).post('/v1/selection-lists', { key, name: key }); // private, owned by the platform org
    expect(made.status).toBe(201);
    const listId: string = made.body.id;
    const item = await w.api(P.op).post(`/v1/selection-lists/${listId}/items`, { code: 'A', label: 'A' });
    expect(item.status).toBe(201);
    return { listId, itemId: item.body.id as string };
  };
  const promote = (listId: string) => async (trx: Knex.Transaction) => {
    await trx('selection_lists').where({ id: listId }).update({ visibility: 'platform' });
  };
  const exists = async (table: string, id: string) => Boolean(await w.db(table).where({ id }).first('id'));

  /** A platform-org list owner WITHOUT publish_platform (an editor who owns this list). */
  const ownerWithoutPublish = (listId: string): Principal => {
    w.authz.give(PLATFORM, P.opEditor.userId, listId, 'list-owner');
    return P.opEditor;
  };

  describe.each([
    ['flag ON', async () => undefined],
    [
      'shared-lists flag OFF',
      async () => {
        const { setFlagClient } = await import('../src/flags');
        setFlagClient({ getBooleanValue: allFlagsExceptShared });
      },
    ],
  ] as Array<[string, () => Promise<void>]>)('%s', (_name, setup) => {
    beforeAll(setup);
    afterAll(async () => {
      const { setFlagClient } = await import('../src/flags');
      const { flagClientWith } = await import('./helpers/flagClient');
      setFlagClient(flagClientWith(true));
    });

    it('list purge: promoted between the middleware read and the lock => an owner without publish_platform is refused (403), nothing deleted', async () => {
      const { listId, itemId } = await privateListWithItem(`race-list-${++n}`);
      const owner = ownerWithoutPublish(listId);
      const res = await raced(() => w.api(owner).del(`/v1/selection-lists/${listId}?purge=true`), promote(listId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await exists('selection_lists', listId)).toBe(true);
      expect(await exists('selection_list_items', itemId)).toBe(true);
      expect((await w.db('selection_lists').where({ id: listId }).first()).visibility).toBe('platform');
      // the refusal rolled back completely: no list.deleted tombstone was queued
      const deleted = await w.db('event_outbox').where({ topic: 'selection-lists.list.deleted' }).whereRaw(`payload::text LIKE ?`, [`%${listId}%`]);
      expect(deleted).toHaveLength(0);
    });

    it('list purge: the same race with a platform operator (publish_platform) goes through', async () => {
      const { listId } = await privateListWithItem(`race-list-op-${++n}`);
      const res = await raced(() => w.api(P.op).del(`/v1/selection-lists/${listId}?purge=true`), promote(listId));
      expect(res.status).toBe(204);
      expect(await exists('selection_lists', listId)).toBe(false);
    });

    it('item purge: promoted between the middleware read and the lock => refused (403), the item survives', async () => {
      const { listId, itemId } = await privateListWithItem(`race-item-${++n}`);
      const owner = ownerWithoutPublish(listId);
      const res = await raced(() => w.api(owner).del(`/v1/selection-lists/${listId}/items/${itemId}?purge=true`), promote(listId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await exists('selection_list_items', itemId)).toBe(true);
      const deleted = await w.db('event_outbox').where({ topic: 'selection-lists.item.deleted' }).whereRaw(`payload::text LIKE ?`, [`%${itemId}%`]);
      expect(deleted).toHaveLength(0);
    });

    it('item purge: the same race with a platform operator goes through', async () => {
      const { listId, itemId } = await privateListWithItem(`race-item-op-${++n}`);
      const res = await raced(() => w.api(P.op).del(`/v1/selection-lists/${listId}/items/${itemId}?purge=true`), promote(listId));
      expect(res.status).toBe(204);
      expect(await exists('selection_list_items', itemId)).toBe(false);
    });
  });

  describe('no race: unchanged behaviour', () => {
    it('an owner purges an ordinary (private) list and item without any publish_platform decision', async () => {
      const { listId, itemId } = await privateListWithItem(`norace-${++n}`);
      const owner = ownerWithoutPublish(listId);
      const mark = w.authz.asked.length;
      expect((await w.api(owner).del(`/v1/selection-lists/${listId}/items/${itemId}?purge=true`)).status).toBe(204);
      expect((await w.api(owner).del(`/v1/selection-lists/${listId}?purge=true`)).status).toBe(204);
      expect(w.authz.since(mark)).not.toContain('catalog:publish_platform');
    });

    it('archiving (not a purge) a list promoted mid-request is NOT a platform-operator act: the owner may archive it', async () => {
      const { listId } = await privateListWithItem(`race-archive-${++n}`);
      const owner = ownerWithoutPublish(listId);
      const res = await raced(() => w.api(owner).del(`/v1/selection-lists/${listId}`), promote(listId));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('archived');
    });
  });
});
