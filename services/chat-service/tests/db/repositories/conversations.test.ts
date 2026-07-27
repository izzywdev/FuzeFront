// conversations.test.ts — conversation repo scopes every read/write by userId
// (never by request body) — §10d — plus the app/org tenant filters (migration
// 002). Knex is mocked with a chainable stub.

import { ConversationsRepository } from '../../../src/db/repositories/conversations';

function makeKnex() {
  const state: any = { table: null, wheres: [], inserted: null, returning: null };
  const qb: any = {
    where: jest.fn((cond: any) => {
      state.wheres.push(cond);
      return qb;
    }),
    andWhere: jest.fn((cond: any) => {
      // knex accepts a callback for a grouped condition — invoke it against the
      // same builder so the nested whereNull/orWhere calls are recorded too.
      if (typeof cond === 'function') {
        cond(qb);
        state.wheres.push({ __grouped: true });
      } else {
        state.wheres.push(cond);
      }
      return qb;
    }),
    whereNull: jest.fn((col: string) => {
      state.wheres.push({ __null: col });
      return qb;
    }),
    orWhere: jest.fn((cond: any) => {
      state.wheres.push({ __or: cond });
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    select: jest.fn(() => Promise.resolve(state.selectResult ?? [])),
    first: jest.fn(() => Promise.resolve(state.firstResult)),
    insert: jest.fn((row: any) => {
      state.inserted = row;
      return qb;
    }),
    returning: jest.fn(() => Promise.resolve(state.returningResult)),
    update: jest.fn((row: any) => {
      state.updated = row;
      return Promise.resolve(1);
    }),
  };
  const knex: any = jest.fn((table: string) => {
    state.table = table;
    return qb;
  });
  knex.fn = { now: () => 'NOW()' };
  return { knex, qb, state };
}

describe('ConversationsRepository', () => {
  it('list filters by userId and orders by updated_at desc', async () => {
    const { knex, qb, state } = makeKnex();
    state.selectResult = [
      {
        id: 'c1',
        title: 'T',
        app_id: 'fuzefront',
        org_id: 'org-1',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ];
    const repo = new ConversationsRepository(knex);
    const result = await repo.list('user-1');
    expect(knex).toHaveBeenCalledWith('chat_conversations');
    expect(qb.where).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(qb.orderBy).toHaveBeenCalledWith('updated_at', 'desc');
    expect(result[0]).toMatchObject({ id: 'c1', title: 'T', appId: 'fuzefront', orgId: 'org-1' });
  });

  it('list narrows by appId and orgId when a filter is given', async () => {
    const { knex, qb, state } = makeKnex();
    state.selectResult = [];
    const repo = new ConversationsRepository(knex);
    await repo.list('user-1', { appId: 'mendys', orgId: 'org-9' });
    expect(qb.where).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(qb.andWhere).toHaveBeenCalledWith({ app_id: 'mendys' });
    expect(qb.andWhere).toHaveBeenCalledWith({ org_id: 'org-9' });
  });

  it('findById scopes by BOTH id and userId so users cannot read others conversations', async () => {
    const { knex, qb, state } = makeKnex();
    state.firstResult = { id: 'c1', user_id: 'user-1', title: 'T', app_id: 'fuzefront' };
    const repo = new ConversationsRepository(knex);
    await repo.findById('c1', 'user-1');
    expect(qb.where).toHaveBeenCalledWith({ id: 'c1', user_id: 'user-1' });
  });

  it('create inserts user_id + app_id from the argument and returns the new row', async () => {
    const { knex, state } = makeKnex();
    state.returningResult = [{ id: 'c-new', title: 'Hi', app_id: 'mendys', org_id: 'org-1' }];
    const repo = new ConversationsRepository(knex);
    const created = await repo.create({
      userId: 'user-1',
      appId: 'mendys',
      orgId: 'org-1',
      title: 'Hi',
    });
    expect(state.inserted).toMatchObject({
      user_id: 'user-1',
      app_id: 'mendys',
      org_id: 'org-1',
      title: 'Hi',
    });
    expect(created.id).toBe('c-new');
    expect(created.appId).toBe('mendys');
  });

  it('create normalises an empty orgId to NULL', async () => {
    const { knex, state } = makeKnex();
    state.returningResult = [{ id: 'c1', title: null, app_id: 'fuzefront', org_id: null }];
    const repo = new ConversationsRepository(knex);
    await repo.create({ userId: 'user-1', appId: 'fuzefront', orgId: '' });
    expect(state.inserted).toMatchObject({ org_id: null });
  });

  describe('getOrCreateContinuous — the single ongoing thread (#120)', () => {
    it('returns the most-recent existing thread for the (user, app, org) scope', async () => {
      const { knex, qb, state } = makeKnex();
      state.firstResult = {
        id: 'c-existing',
        title: null,
        app_id: 'fuzefront',
        org_id: 'org-1',
        created_at: 'a',
        updated_at: 'b',
      };
      const repo = new ConversationsRepository(knex);
      const result = await repo.getOrCreateContinuous({
        userId: 'user-1',
        appId: 'fuzefront',
        orgId: 'org-1',
      });

      expect(qb.where).toHaveBeenCalledWith({ user_id: 'user-1', app_id: 'fuzefront' });
      expect(qb.andWhere).toHaveBeenCalledWith({ org_id: 'org-1' });
      // Most-recent-first: the lookup migration 002's
      // (user_id, app_id, org_id, updated_at DESC) index was built to serve.
      expect(qb.orderBy).toHaveBeenCalledWith('updated_at', 'desc');
      expect(result.id).toBe('c-existing');
      // An existing thread was found -> must NOT insert a second one.
      expect(state.inserted).toBeNull();
    });

    it('creates the thread on first ever use for the scope', async () => {
      const { knex, state } = makeKnex();
      state.firstResult = undefined;
      state.returningResult = [{ id: 'c-first', title: null, app_id: 'fuzefront', org_id: 'org-1' }];
      const repo = new ConversationsRepository(knex);
      const result = await repo.getOrCreateContinuous({
        userId: 'user-1',
        appId: 'fuzefront',
        orgId: 'org-1',
      });

      expect(state.inserted).toMatchObject({
        user_id: 'user-1',
        app_id: 'fuzefront',
        org_id: 'org-1',
      });
      expect(result.id).toBe('c-first');
    });

    it('matches BOTH NULL and legacy empty-string org_id when the caller has no org', async () => {
      const { knex, qb, state } = makeKnex();
      state.firstResult = undefined;
      state.returningResult = [{ id: 'c-new', title: null, app_id: 'fuzefront', org_id: null }];
      const repo = new ConversationsRepository(knex);
      // The route derives orgId as `body.orgId || req.orgId || ''`, so "no org"
      // reaches the repo as an empty string.
      await repo.getOrCreateContinuous({ userId: 'user-1', appId: 'fuzefront', orgId: '' });

      expect(qb.whereNull).toHaveBeenCalledWith('org_id');
      expect(qb.orWhere).toHaveBeenCalledWith({ org_id: '' });
      // '' must never be stored as a tenant distinct from NULL, or one user's
      // thread splits in two.
      expect(state.inserted).toMatchObject({ org_id: null });
    });

    it('keeps different apps on separate threads for the same user', async () => {
      const { knex, qb, state } = makeKnex();
      state.firstResult = undefined;
      state.returningResult = [{ id: 'c-mendys', title: null, app_id: 'mendys', org_id: 'org-1' }];
      const repo = new ConversationsRepository(knex);
      await repo.getOrCreateContinuous({ userId: 'user-1', appId: 'mendys', orgId: 'org-1' });

      expect(qb.where).toHaveBeenCalledWith({ user_id: 'user-1', app_id: 'mendys' });
      expect(state.inserted).toMatchObject({ app_id: 'mendys' });
    });
  });

  it('touch updates updated_at scoped by id + userId', async () => {
    const { knex, qb } = makeKnex();
    const repo = new ConversationsRepository(knex);
    await repo.touch('c1', 'user-1');
    expect(qb.where).toHaveBeenCalledWith({ id: 'c1', user_id: 'user-1' });
    expect(qb.update).toHaveBeenCalled();
  });
});
