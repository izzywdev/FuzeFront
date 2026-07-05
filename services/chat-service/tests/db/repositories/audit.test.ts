// audit.test.ts — chat_audit_log repository writes an immutable row per mutating
// tool execution. user_id/org_id come from the caller; args/result are JSON.

import { AuditRepository } from '../../../src/db/repositories/audit';

function makeKnex() {
  const state: any = { table: null, inserted: null, returningResult: [{ id: 'audit-1' }] };
  const qb: any = {
    insert: jest.fn((row: any) => {
      state.inserted = row;
      return qb;
    }),
    returning: jest.fn(() => Promise.resolve(state.returningResult)),
  };
  const knex: any = jest.fn((table: string) => {
    state.table = table;
    return qb;
  });
  return { knex, qb, state };
}

describe('AuditRepository', () => {
  it('records an allowed execution with serialized args + result', async () => {
    const { knex, state } = makeKnex();
    const repo = new AuditRepository(knex);
    const out = await repo.record({
      conversationId: 'conv-1',
      userId: 'u1',
      orgId: 'org-1',
      toolName: 'create_org',
      args: { name: 'Acme' },
      result: { id: 'org-9' },
      permitDecision: 'allowed',
      confirmed: true,
    });
    expect(state.table).toBe('chat_audit_log');
    expect(state.inserted).toMatchObject({
      conversation_id: 'conv-1',
      user_id: 'u1',
      org_id: 'org-1',
      tool_name: 'create_org',
      permit_decision: 'allowed',
      confirmed: true,
    });
    expect(JSON.parse(state.inserted.args)).toEqual({ name: 'Acme' });
    expect(JSON.parse(state.inserted.result)).toEqual({ id: 'org-9' });
    expect(out).toEqual({ id: 'audit-1' });
  });

  it('records a denied decision with null result', async () => {
    const { knex, state } = makeKnex();
    const repo = new AuditRepository(knex);
    await repo.record({
      userId: 'u1',
      toolName: 'create_org',
      args: {},
      permitDecision: 'denied',
      confirmed: true,
    });
    expect(state.inserted.permit_decision).toBe('denied');
    expect(state.inserted.result).toBeNull();
    expect(state.inserted.conversation_id).toBeNull();
    expect(state.inserted.org_id).toBeNull();
  });
});
