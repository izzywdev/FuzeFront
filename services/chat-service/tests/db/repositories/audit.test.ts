// audit.test.ts — audit repo writes one row to chat_audit_log with serialized
// JSONB args/result and the permit decision. Knex mocked (no real DB).

import { AuditLogRepository } from '../../../src/db/repositories/audit';

function makeKnex() {
  const state: any = { table: null, inserted: null };
  const qb: any = {
    insert: jest.fn((row: any) => {
      state.inserted = row;
      return Promise.resolve([1]);
    }),
  };
  const knex: any = jest.fn((table: string) => {
    state.table = table;
    return qb;
  });
  return { knex, qb, state };
}

describe('AuditLogRepository.record', () => {
  it('inserts into chat_audit_log with serialized args/result and decision', async () => {
    const { knex, state } = makeKnex();
    const repo = new AuditLogRepository(knex);
    await repo.record({
      conversationId: 'c1',
      userId: 'user-1',
      orgId: 'org-1',
      toolName: 'create_org',
      args: { name: 'Acme', slug: 'acme' },
      result: { success: true, summary: 'Created organization "Acme".' },
      permitDecision: 'allowed',
      confirmed: true,
    });

    expect(knex).toHaveBeenCalledWith('chat_audit_log');
    expect(state.inserted).toMatchObject({
      conversation_id: 'c1',
      user_id: 'user-1',
      org_id: 'org-1',
      tool_name: 'create_org',
      permit_decision: 'allowed',
      confirmed: true,
    });
    // JSONB columns are JSON-stringified on write.
    expect(JSON.parse(state.inserted.args)).toEqual({ name: 'Acme', slug: 'acme' });
    expect(JSON.parse(state.inserted.result)).toEqual({
      success: true,
      summary: 'Created organization "Acme".',
    });
  });

  it('records a denied decision with NULL result and defaults nullable fields', async () => {
    const { knex, state } = makeKnex();
    const repo = new AuditLogRepository(knex);
    await repo.record({
      userId: 'user-1',
      toolName: 'invite_member',
      args: { orgId: 'o', email: 'a@b.c', role: 'member' },
      permitDecision: 'denied',
      confirmed: true,
    });

    expect(state.inserted.permit_decision).toBe('denied');
    expect(state.inserted.result).toBeNull();
    expect(state.inserted.conversation_id).toBeNull();
    expect(state.inserted.org_id).toBeNull();
    expect(JSON.parse(state.inserted.args)).toEqual({
      orgId: 'o',
      email: 'a@b.c',
      role: 'member',
    });
  });
});
