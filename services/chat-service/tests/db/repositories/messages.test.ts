// messages.test.ts — messages repo joins ownership through chat_conversations so
// reads are scoped to the authenticated user (§10d). Knex mocked.

import { MessagesRepository } from '../../../src/db/repositories/messages';

function makeKnex() {
  const state: any = {};
  const qb: any = {
    insert: jest.fn((row: any) => {
      state.inserted = row;
      return qb;
    }),
    returning: jest.fn(() => Promise.resolve(state.returningResult)),
    join: jest.fn(() => qb),
    where: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    select: jest.fn(() => Promise.resolve(state.selectResult ?? [])),
  };
  const knex: any = jest.fn(() => qb);
  return { knex, qb, state };
}

describe('MessagesRepository', () => {
  it('append inserts a message with serialized JSON content', async () => {
    const { knex, state } = makeKnex();
    state.returningResult = [{ id: 'm1' }];
    const repo = new MessagesRepository(knex);
    const out = await repo.append({
      conversationId: 'c1',
      role: 'assistant',
      content: { type: 'text', text: 'hi' },
    });
    expect(state.inserted).toMatchObject({
      conversation_id: 'c1',
      role: 'assistant',
    });
    // content stored as JSON
    expect(JSON.parse(state.inserted.content)).toEqual({ type: 'text', text: 'hi' });
    expect(out.id).toBe('m1');
  });

  it('listForConversation joins conversations and filters by user_id', async () => {
    const { knex, qb, state } = makeKnex();
    state.selectResult = [
      { id: 'm1', role: 'user', content: JSON.stringify({ type: 'text', text: 'q' }), created_at: 't' },
    ];
    const repo = new MessagesRepository(knex);
    const msgs = await repo.listForConversation('c1', 'user-1');
    // ownership enforced via join + where on conversations.user_id
    const whereCalls = qb.where.mock.calls.flat();
    const joinedOnUser = JSON.stringify(whereCalls).includes('user-1');
    expect(joinedOnUser).toBe(true);
    expect(qb.join).toHaveBeenCalled();
    expect(msgs[0].content).toEqual({ type: 'text', text: 'q' });
  });

  it('parses stored JSON content back into an object', async () => {
    const { knex, state } = makeKnex();
    state.selectResult = [
      { id: 'm1', role: 'assistant', content: '{"type":"text","text":"hello"}', created_at: 't' },
    ];
    const repo = new MessagesRepository(knex);
    const msgs = await repo.listForConversation('c1', 'user-1');
    expect(msgs[0].content).toEqual({ type: 'text', text: 'hello' });
  });
});
