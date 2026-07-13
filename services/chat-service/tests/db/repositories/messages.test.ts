// messages.test.ts — messages repo joins ownership through chat_conversations so
// reads are scoped to the authenticated user (§10d), and pages history on the
// (created_at, id) keyset for bidirectional infinite scroll. Knex mocked.

import { CursorNotFoundError, MessagesRepository } from '../../../src/db/repositories/messages';

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
    whereRaw: jest.fn((sql: string, bindings: unknown[]) => {
      state.whereRaw = { sql, bindings };
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    limit: jest.fn((n: number) => {
      state.limit = n;
      return qb;
    }),
    first: jest.fn(() => Promise.resolve(state.anchorResult)),
    select: jest.fn(() => Promise.resolve(state.selectResult ?? [])),
  };
  const knex: any = jest.fn(() => qb);
  return { knex, qb, state };
}

function row(id: string, at: string, text = 'x') {
  return { id, role: 'user', content: JSON.stringify({ type: 'text', text }), created_at: at };
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
    state.selectResult = [row('m1', 't', 'q')];
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

  describe('listPage', () => {
    it('tail page (no cursor): newest limit messages, chronological, overflow -> hasMoreBefore', async () => {
      const { knex, qb, state } = makeKnex();
      // DESC fetch of limit+1 = 3 rows
      state.selectResult = [row('m3', '3'), row('m2', '2'), row('m1', '1')];
      const repo = new MessagesRepository(knex);
      const page = await repo.listPage('c1', 'user-1', { limit: 2 });

      expect(state.limit).toBe(3); // limit + 1 overflow probe
      expect(page.messages.map((m) => m.id)).toEqual(['m2', 'm3']); // oldest-first
      expect(page.hasMoreBefore).toBe(true);
      expect(page.hasMoreAfter).toBe(false);
      // ownership join still applies to paged reads
      expect(qb.join).toHaveBeenCalled();
      expect(JSON.stringify(qb.where.mock.calls.flat())).toContain('user-1');
    });

    it('tail page without overflow reports no more history', async () => {
      const { knex, state } = makeKnex();
      state.selectResult = [row('m2', '2'), row('m1', '1')];
      const repo = new MessagesRepository(knex);
      const page = await repo.listPage('c1', 'user-1', { limit: 5 });
      expect(page.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(page.hasMoreBefore).toBe(false);
      expect(page.hasMoreAfter).toBe(false);
    });

    it('before cursor pages towards older messages on the (created_at, id) keyset', async () => {
      const { knex, state } = makeKnex();
      state.anchorResult = { created_at: '5' };
      state.selectResult = [row('m4', '4'), row('m3', '3'), row('m2', '2')]; // overflow at limit 2
      const repo = new MessagesRepository(knex);
      const page = await repo.listPage('c1', 'user-1', { before: 'm5', limit: 2 });

      expect(state.whereRaw.sql).toContain('<');
      expect(state.whereRaw.bindings).toEqual(['5', 'm5']);
      expect(page.messages.map((m) => m.id)).toEqual(['m3', 'm4']);
      expect(page.hasMoreBefore).toBe(true);
      // the anchor itself sits after the page
      expect(page.hasMoreAfter).toBe(true);
    });

    it('after cursor pages towards newer messages', async () => {
      const { knex, state } = makeKnex();
      state.anchorResult = { created_at: '1' };
      state.selectResult = [row('m2', '2'), row('m3', '3')]; // no overflow at limit 2
      const repo = new MessagesRepository(knex);
      const page = await repo.listPage('c1', 'user-1', { after: 'm1', limit: 2 });

      expect(state.whereRaw.sql).toContain('>');
      expect(state.whereRaw.bindings).toEqual(['1', 'm1']);
      expect(page.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
      expect(page.hasMoreBefore).toBe(true);
      expect(page.hasMoreAfter).toBe(false);
    });

    it('throws CursorNotFoundError for a cursor outside the conversation', async () => {
      const { knex, state } = makeKnex();
      state.anchorResult = undefined;
      const repo = new MessagesRepository(knex);
      await expect(repo.listPage('c1', 'user-1', { before: 'ghost', limit: 2 })).rejects.toThrow(
        CursorNotFoundError,
      );
    });
  });
});
