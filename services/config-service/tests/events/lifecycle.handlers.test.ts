import { Pool } from 'pg';
import { handleOrgDeleted } from '../../src/events/org-deleted.handler';
import { handleUserDeleted } from '../../src/events/user-deleted.handler';

/**
 * A pg.Pool stand-in that records every statement issued on the checked-out
 * client, so these tests can assert on the REAL SQL the handlers send rather
 * than on a reimplementation of their behaviour.
 *
 * `rowCounts` supplies the rowCount each non-transaction statement reports, in
 * order, which is what drives the handlers' no-op vs did-work branches.
 */
function fakePool(rowCounts: number[] = [], failOn?: RegExp) {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  let next = 0;

  const client = {
    // Records EVERY statement, including the ones that then throw — otherwise
    // the rollback assertions below would inspect an empty log and pass
    // vacuously no matter what the handler did.
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      if (failOn && failOn.test(sql)) throw new Error('boom');
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: rowCounts[next++] ?? 0, rows: [] };
    }),
    release: jest.fn(() => {
      released = true;
    }),
  };

  const pool = { connect: jest.fn(async () => client) } as unknown as Pool;
  return {
    pool,
    client,
    statements,
    sqlText: () => statements.map((s) => s.sql).join('\n---\n'),
    wasReleased: () => released,
  };
}

const orgEvent = (organizationId: string, cascade: 'soft' | 'hard' = 'hard') =>
  ({ correlationId: 'corr-org-1', payload: { organizationId, cascade } }) as never;

const userEvent = (userId: string, cascade: 'soft' | 'hard' = 'hard') =>
  ({ correlationId: 'corr-user-1', payload: { userId, cascade } }) as never;

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('handleOrgDeleted', () => {
  it('deletes only the org-scoped config_values rows, in a transaction', async () => {
    const f = fakePool([3]);
    await handleOrgDeleted(f.pool, orgEvent('org-123'));

    expect(f.statements[0].sql).toMatch(/^\s*BEGIN/i);
    expect(f.statements[f.statements.length - 1].sql).toMatch(/^\s*COMMIT/i);

    const del = f.statements[1];
    expect(del.sql).toMatch(/DELETE FROM config\.config_values/i);
    expect(del.sql).toMatch(/scope_type\s*=\s*'org'/i);
    expect(del.params).toEqual(['org-123']);
    expect(f.wasReleased()).toBe(true);
  });

  it('NEVER touches config_history — migration 004 declares it append-only', async () => {
    const f = fakePool([3]);
    await handleOrgDeleted(f.pool, orgEvent('org-123'));
    expect(f.sqlText()).not.toMatch(/config_history/i);
  });

  it('is idempotent: deleting 0 rows still commits and does not throw', async () => {
    const f = fakePool([0]);
    await expect(handleOrgDeleted(f.pool, orgEvent('org-none'))).resolves.toBeUndefined();
    expect(f.sqlText()).toMatch(/COMMIT/i);
  });

  it('rolls back and rethrows when the delete fails', async () => {
    const f = fakePool([], /DELETE/i);
    await expect(handleOrgDeleted(f.pool, orgEvent('org-123'))).rejects.toThrow('boom');
    expect(f.sqlText()).toMatch(/ROLLBACK/i);
    expect(f.wasReleased()).toBe(true);
  });
});

describe('handleUserDeleted', () => {
  it('deletes user-scoped values AND anonymises authorship on survivors', async () => {
    const f = fakePool([2, 5]);
    await handleUserDeleted(f.pool, userEvent('user-abc'));

    const del = f.statements[1];
    expect(del.sql).toMatch(/DELETE FROM config\.config_values/i);
    expect(del.sql).toMatch(/scope_type\s*=\s*'user'/i);
    expect(del.params).toEqual(['user-abc']);

    const upd = f.statements[2];
    expect(upd.sql).toMatch(/UPDATE config\.config_values/i);
    expect(upd.sql).toMatch(/set_by_user_id\s*=\s*NULL/i);
    expect(upd.params).toEqual(['user-abc']);
  });

  it('deletes before anonymising, so doomed rows are not rewritten first', async () => {
    const f = fakePool([2, 5]);
    await handleUserDeleted(f.pool, userEvent('user-abc'));
    const order = f.statements.map((s) => s.sql);
    expect(order.findIndex((s) => /DELETE/i.test(s))).toBeLessThan(
      order.findIndex((s) => /UPDATE/i.test(s)),
    );
  });

  it('does NOT delete rows merely authored by the user — it nulls the author', async () => {
    const f = fakePool([0, 4]);
    await handleUserDeleted(f.pool, userEvent('user-abc'));
    const deletes = f.statements.filter((s) => /DELETE/i.test(s.sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].sql).toMatch(/scope_type\s*=\s*'user'/i);
  });

  it('NEVER touches config_history — actor_id redaction needs a schema change', async () => {
    const f = fakePool([2, 5]);
    await handleUserDeleted(f.pool, userEvent('user-abc'));
    expect(f.sqlText()).not.toMatch(/config_history/i);
  });

  it('is idempotent: no overrides and no authorship is a clean no-op', async () => {
    const f = fakePool([0, 0]);
    await expect(handleUserDeleted(f.pool, userEvent('ghost'))).resolves.toBeUndefined();
    expect(f.sqlText()).toMatch(/COMMIT/i);
  });

  it('rolls back and rethrows when the update fails', async () => {
    const f = fakePool([1], /UPDATE/i);
    await expect(handleUserDeleted(f.pool, userEvent('user-abc'))).rejects.toThrow('boom');
    expect(f.sqlText()).toMatch(/ROLLBACK/i);
    expect(f.wasReleased()).toBe(true);
  });
});
