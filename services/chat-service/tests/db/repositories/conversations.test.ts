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
      state.wheres.push(cond);
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

  it('touch updates updated_at scoped by id + userId', async () => {
    const { knex, qb } = makeKnex();
    const repo = new ConversationsRepository(knex);
    await repo.touch('c1', 'user-1');
    expect(qb.where).toHaveBeenCalledWith({ id: 'c1', user_id: 'user-1' });
    expect(qb.update).toHaveBeenCalled();
  });
});
