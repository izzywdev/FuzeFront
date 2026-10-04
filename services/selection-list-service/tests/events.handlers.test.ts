// events.handlers.test.ts — identity.org.deleted / identity.user.deleted handlers
// (review M-3, rollout blocker B7).
//
// The org-deleted handler used to query `selection_lists.org_id`,
// `selection_list_org_quota.org_id` and `is_active` — none of which exist — so
// EVERY identity.org.deleted event threw and a deleted org's data was kept
// forever. A mocked knex cannot see that, so these tests:
//   1. record every (table, column) a handler touches and check each against
//      the schema PARSED FROM THE REAL MIGRATIONS (helpers/schema.ts), and
//   2. assert behaviour: idempotency, soft vs hard, FK-safe delete order, one
//      transaction, failures propagate (never swallowed), the DLQ is untouched
//      on success.
// tests/handlers.db.test.ts re-runs the same scenarios against real Postgres.

import { makeRecordingDb } from './helpers/recordingDb';
import { unknownColumns, loadSchema } from './helpers/schema';

const state: { rec: ReturnType<typeof makeRecordingDb> } = { rec: makeRecordingDb() };
jest.mock('../src/db', () => ({
  get db() {
    return state.rec.db;
  },
}));

import { fromUuid } from '@izzywdev/fuzefront-identity';
import { handleOrgDeleted } from '../src/events/org-deleted.handler';
import { handleUserDeleted } from '../src/events/user-deleted.handler';

const ORG_UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c8d';
const USER_UUID = '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7c8d';
const ORG_TYPEID = fromUuid('organization', ORG_UUID);
const USER_TYPEID = fromUuid('user', USER_UUID);

const orgEvent = (cascade: 'soft' | 'hard') =>
  ({
    version: '1.0',
    topic: 'identity.org.deleted',
    correlationId: 'corr-1',
    occurredAt: '2026-10-04T00:00:00.000Z',
    payload: { organizationId: ORG_UUID, slug: 'acme', ownerId: null, cascade },
  }) as any;

const userEvent = (cascade: 'soft' | 'hard' = 'soft') =>
  ({
    version: '1.0',
    topic: 'identity.user.deleted',
    correlationId: 'corr-2',
    occurredAt: '2026-10-04T00:00:00.000Z',
    payload: { userId: USER_UUID, email: 'gone@example.com', cascade },
  }) as any;

describe('schema truth (parsed from the real migrations)', () => {
  it('knows the columns the handlers must use', () => {
    const s = loadSchema();
    expect([...s.selection_lists]).toEqual(expect.arrayContaining(['id', 'organization_id', 'status', 'created_by', 'updated_at']));
    expect([...s.selection_list_org_quota]).toContain('organization_id');
    expect([...s.selection_list_access]).toEqual(expect.arrayContaining(['list_id', 'user_id', 'granted_by', 'org_id']));
    expect([...s.selection_list_audit]).toEqual(expect.arrayContaining(['list_id', 'item_id']));
  });

  it('the guard bites: the columns the old handler used are NOT in the schema', () => {
    expect(
      unknownColumns([
        ['selection_lists', 'org_id'],
        ['selection_lists', 'is_active'],
        ['selection_list_org_quota', 'org_id'],
      ]),
    ).toEqual(['selection_lists.org_id', 'selection_lists.is_active', 'selection_list_org_quota.org_id']);
  });
});

describe('handleOrgDeleted — hard cascade', () => {
  it('purges every table in FK-safe order inside ONE transaction, with real column names', async () => {
    state.rec = makeRecordingDb({
      pluck: { 'selection_lists.id': ['front_sl_a', 'front_sl_b'], 'selection_list_items.id': ['front_sli_1'] },
    });
    await handleOrgDeleted(orgEvent('hard'));

    expect(unknownColumns(state.rec.used)).toEqual([]);
    expect(state.rec.ops).toEqual([
      'tx:begin',
      'pluck:selection_lists.id',
      'delete:selection_list_access',
      'pluck:selection_list_items.id',
      'delete:selection_list_audit', // by list_id
      'delete:selection_list_audit', // by item_id
      'delete:selection_list_item_translations',
      'delete:selection_list_translations',
      'delete:selection_list_items',
      'delete:selection_lists',
      'delete:selection_list_org_quota',
      'delete:selection_list_seed_ledger',
      'tx:commit',
    ]);
  });

  it('deletes access rows by list_id (access.org_id is nullable and unreliable), never by org', async () => {
    state.rec = makeRecordingDb({ pluck: { 'selection_lists.id': ['front_sl_a'] } });
    await handleOrgDeleted(orgEvent('hard'));
    expect(state.rec.whereIns['selection_list_access.list_id']).toEqual([['front_sl_a']]);
    expect(state.rec.used).not.toContainEqual(['selection_list_access', 'org_id']);
  });

  it('matches BOTH renderings of the org id (bare UUID from the event, org_ TypeID as stored from tokens)', async () => {
    state.rec = makeRecordingDb({ pluck: { 'selection_lists.id': ['front_sl_a'] } });
    await handleOrgDeleted(orgEvent('hard'));
    const [forms] = state.rec.whereIns['selection_lists.organization_id'];
    expect(forms).toEqual(expect.arrayContaining([ORG_UUID, ORG_TYPEID]));
    expect(state.rec.whereIns['selection_list_org_quota.organization_id'][0]).toEqual(
      expect.arrayContaining([ORG_UUID, ORG_TYPEID]),
    );
  });

  it('is idempotent: an org with no lists is a no-op except clearing its quota row; no list tables touched', async () => {
    state.rec = makeRecordingDb({ pluck: { 'selection_lists.id': [] } });
    await expect(handleOrgDeleted(orgEvent('hard'))).resolves.toBeUndefined();
    expect(state.rec.ops).toEqual(['tx:begin', 'pluck:selection_lists.id', 'delete:selection_list_org_quota', 'delete:selection_list_seed_ledger', 'tx:commit']);
    // Replaying the same event again is equally harmless.
    state.rec = makeRecordingDb({ pluck: { 'selection_lists.id': [] } });
    await expect(handleOrgDeleted(orgEvent('hard'))).resolves.toBeUndefined();
  });

  it('a failure mid-purge ROLLS BACK and PROPAGATES (the consumer must see it — never swallowed)', async () => {
    state.rec = makeRecordingDb({ pluck: { 'selection_lists.id': ['front_sl_a'] } });
    const original = state.rec.db.transaction;
    state.rec.db.transaction = (cb: any) =>
      original(async (trx: any) => {
        const wrapped: any = (t: string) => {
          const b = trx(t);
          if (t === 'selection_list_translations') {
            return { whereIn: () => ({ delete: () => Promise.reject(new Error('fk violation')) }) };
          }
          return b;
        };
        wrapped.fn = trx.fn;
        return cb(wrapped);
      });
    await expect(handleOrgDeleted(orgEvent('hard'))).rejects.toThrow('fk violation');
    expect(state.rec.ops).toContain('tx:rollback');
    expect(state.rec.ops).not.toContain('tx:commit');
  });
});

describe('handleOrgDeleted — soft cascade', () => {
  it('archives the org\'s ACTIVE lists (status column, not is_active) and deletes nothing', async () => {
    state.rec = makeRecordingDb({ update: { selection_lists: 3 } });
    await handleOrgDeleted(orgEvent('soft'));

    expect(unknownColumns(state.rec.used)).toEqual([]);
    expect(state.rec.ops).toEqual(['update:selection_lists']);
    expect(state.rec.updates.selection_lists).toHaveLength(1);
    expect(state.rec.updates.selection_lists[0]).toMatchObject({ status: 'archived' });
    expect(state.rec.updates.selection_lists[0]).not.toHaveProperty('is_active');
    expect(state.rec.used).toContainEqual(['selection_lists', 'status']); // where status='active'
    expect(state.rec.ops.some((o) => o.startsWith('delete:'))).toBe(false);
    expect(state.rec.ops).not.toContain('tx:begin');
  });

  it('is idempotent: nothing active left -> 0 rows, no error', async () => {
    state.rec = makeRecordingDb({ update: { selection_lists: 0 } });
    await expect(handleOrgDeleted(orgEvent('soft'))).resolves.toBeUndefined();
  });

  it('matches both id renderings', async () => {
    state.rec = makeRecordingDb({ update: { selection_lists: 1 } });
    await handleOrgDeleted(orgEvent('soft'));
    expect(state.rec.whereIns['selection_lists.organization_id'][0]).toEqual(expect.arrayContaining([ORG_UUID, ORG_TYPEID]));
  });

  it('propagates a DB failure', async () => {
    state.rec = makeRecordingDb();
    state.rec.db.transaction = undefined;
    const original = state.rec.db;
    const failing: any = (t: string) => {
      const b = original(t);
      b.then = (_res: unknown, rej: (e: unknown) => unknown) => Promise.reject(new Error('db down')).then(undefined, rej);
      return b;
    };
    failing.fn = original.fn;
    state.rec = { ...state.rec, db: failing };
    await expect(handleOrgDeleted(orgEvent('soft'))).rejects.toThrow('db down');
  });
});

describe('handleUserDeleted', () => {
  it('anonymises authorship in the three real columns, matching both id renderings', async () => {
    state.rec = makeRecordingDb({ update: { selection_lists: 2, selection_list_items: 1, selection_list_access: 4 } });
    await handleUserDeleted(userEvent('soft'));

    expect(unknownColumns(state.rec.used)).toEqual([]);
    expect(state.rec.ops.sort()).toEqual(
      ['update:selection_list_access', 'update:selection_list_items', 'update:selection_lists'].sort(),
    );
    expect(state.rec.updates.selection_lists[0]).toEqual({ created_by: '[deleted-user]' });
    expect(state.rec.updates.selection_list_items[0]).toEqual({ created_by: '[deleted-user]' });
    expect(state.rec.updates.selection_list_access[0]).toEqual({ granted_by: '[deleted-user]' });
    for (const key of ['selection_lists.created_by', 'selection_list_items.created_by', 'selection_list_access.granted_by']) {
      expect(state.rec.whereIns[key][0]).toEqual(expect.arrayContaining([USER_UUID, USER_TYPEID]));
    }
  });

  it('hard and soft are equivalent here (all data is org-scoped; nothing user-scoped to purge)', async () => {
    state.rec = makeRecordingDb({ update: { selection_lists: 1 } });
    await handleUserDeleted(userEvent('hard'));
    const hardOps = [...state.rec.ops].sort();
    state.rec = makeRecordingDb({ update: { selection_lists: 1 } });
    await handleUserDeleted(userEvent('soft'));
    expect([...state.rec.ops].sort()).toEqual(hardOps);
    expect(state.rec.ops.some((o) => o.startsWith('delete:'))).toBe(false);
  });

  it('is idempotent: a user with no references is a no-op, no error', async () => {
    state.rec = makeRecordingDb({ update: { selection_lists: 0, selection_list_items: 0, selection_list_access: 0 } });
    await expect(handleUserDeleted(userEvent())).resolves.toBeUndefined();
  });
});
