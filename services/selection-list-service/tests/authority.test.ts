// authority.test.ts — services/authority.ts in isolation (review M-2 / L-5): the last-owner guard's
// candidate/chunk logic, the compensation steps, and the best-effort bulk revoke.

import { _setAuthzClientForTesting, makeNoOpProxy } from '../src/middleware/authz';
import { hasConfirmedOtherOwner, restoreAuthority, revokeInstanceGrants } from '../src/services/authority';
import { authzCompensationTotal, grantCleanupFailedTotal, ownerDriftTotal } from '../src/lib/metrics';
import { logger } from '../src/lib/logger';

const LIST = 'front_sl_authority01';
const ORG = 'org_corp';
const log = logger.child({ test: 'authority' });

/** The only Knex surface hasConfirmedOtherOwner touches: executor(table).where().whereNull().select(). */
function executorWith(rows: Array<{ user_id: string }>): any {
  const q: any = {
    where: jest.fn(() => q),
    whereNull: jest.fn(() => q),
    select: jest.fn(async () => rows),
  };
  const ex: any = jest.fn(() => q);
  ex.q = q;
  return ex;
}
const owners = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: `usr_${String(i).padStart(4, '0')}` }));
const counter = async (
  c: { get: () => Promise<{ values: Array<{ value: number; labels: Record<string, unknown> }> }> },
  labels: Record<string, string> = {},
) =>
  (await c.get()).values
    .filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
    .reduce((n, v) => n + v.value, 0);

afterEach(() => _setAuthzClientForTesting(makeNoOpProxy()));

describe('hasConfirmedOtherOwner', () => {
  const query = (rows: Array<{ user_id: string }>, excludeUserIds = ['usr_gone'], token = 'tok') => ({
    executor: executorWith(rows),
    listId: LIST,
    orgId: ORG,
    excludeUserIds,
    token,
    log,
  });

  it('reads only active list-owner rows of this list as candidates', async () => {
    const q = query(owners(1));
    _setAuthzClientForTesting({
      ...makeNoOpProxy(),
      bulkCheck: jest.fn(async (c: unknown[]) => c.map(() => ({ allow: true }))),
    } as any);
    await hasConfirmedOtherOwner(q);
    expect(q.executor).toHaveBeenCalledWith('selection_list_access');
    expect(q.executor.q.where).toHaveBeenCalledWith({ list_id: LIST, role: 'list-owner' });
    expect(q.executor.q.whereNull).toHaveBeenCalledWith('revoked_at');
  });

  it('no candidates (or only the excluded user, in any rendering) -> false without asking the authority', async () => {
    const bulkCheck = jest.fn();
    _setAuthzClientForTesting({ ...makeNoOpProxy(), bulkCheck } as any);
    expect(await hasConfirmedOtherOwner(query([]))).toBe(false);
    expect(await hasConfirmedOtherOwner(query([{ user_id: 'usr_gone' }]))).toBe(false);
    expect(
      await hasConfirmedOtherOwner(query([{ user_id: 'usr_gone' }, { user_id: 'bare-form' }], ['usr_gone', 'bare-form'])),
    ).toBe(false);
    expect(bulkCheck).not.toHaveBeenCalled();
  });

  it("asks manage_access on THIS instance, in the list's tenant, with the supplied token", async () => {
    const bulkCheck = jest.fn(async (c: unknown[]) => c.map(() => ({ allow: true })));
    _setAuthzClientForTesting({ ...makeNoOpProxy(), bulkCheck } as any);
    expect(await hasConfirmedOtherOwner(query([{ user_id: 'usr_other' }], ['usr_gone'], 'the-token'))).toBe(true);
    expect(bulkCheck).toHaveBeenCalledWith(
      [{ subject: 'usr_other', tenant: ORG, resource: { type: 'SelectionList', key: LIST }, action: 'manage_access' }],
      'the-token',
    );
  });

  it('chunks at the Security API bulk ceiling (200) and stops at the first confirming chunk', async () => {
    const calls: number[] = [];
    const bulkCheck = jest.fn(async (checks: Array<{ subject: string }>) => {
      calls.push(checks.length);
      // only the 451st candidate (last chunk) is a real owner
      return checks.map((c) => ({ allow: c.subject === 'usr_0450' }));
    });
    _setAuthzClientForTesting({ ...makeNoOpProxy(), bulkCheck } as any);
    expect(await hasConfirmedOtherOwner(query(owners(451)))).toBe(true);
    expect(calls).toEqual([200, 200, 51]);

    calls.length = 0;
    const confirmEarly = jest.fn(async (checks: Array<{ subject: string }>) => {
      calls.push(checks.length);
      return checks.map((c) => ({ allow: c.subject === 'usr_0003' }));
    });
    _setAuthzClientForTesting({ ...makeNoOpProxy(), bulkCheck: confirmEarly } as any);
    expect(await hasConfirmedOtherOwner(query(owners(451)))).toBe(true);
    expect(calls).toEqual([200]); // existence is enough: no census
  });

  it('every candidate denied -> false, and the unconfirmed owner rows are counted as drift', async () => {
    _setAuthzClientForTesting({
      ...makeNoOpProxy(),
      bulkCheck: jest.fn(async (c: unknown[]) => c.map(() => ({ allow: false }))),
    } as any);
    const before = await counter(ownerDriftTotal);
    expect(await hasConfirmedOtherOwner(query(owners(3)))).toBe(false);
    expect(await counter(ownerDriftTotal)).toBe(before + 3);
  });

  it('a short / empty decision array is "not confirmed", never an allow', async () => {
    _setAuthzClientForTesting({ ...makeNoOpProxy(), bulkCheck: jest.fn(async () => []) } as any);
    expect(await hasConfirmedOtherOwner(query(owners(2)))).toBe(false);
  });

  it('an authority error propagates (the caller fails closed)', async () => {
    _setAuthzClientForTesting({ ...makeNoOpProxy(), bulkCheck: jest.fn().mockRejectedValue(new Error('down')) } as any);
    await expect(hasConfirmedOtherOwner(query(owners(2)))).rejects.toThrow('down');
  });
});

describe('restoreAuthority', () => {
  const resource = { type: 'SelectionList', key: LIST };
  const base = { subject: 'usr_a', tenant: ORG, listId: LIST, token: 'm', log };

  it('PUT with a prior role: drops the new role first, then re-grants the prior one', async () => {
    const order: string[] = [];
    _setAuthzClientForTesting({
      ...makeNoOpProxy(),
      revoke: jest.fn(async (r: any) => {
        order.push(`revoke:${r.role}`);
      }),
      grant: jest.fn(async (r: any) => {
        order.push(`grant:${r.role}`);
        return {} as any;
      }),
    } as any);
    await restoreAuthority({
      ...base,
      op: 'put',
      prior: 'list-viewer',
      target: 'list-editor',
      writes: { revokeAttempted: true, grantAttempted: true },
    });
    expect(order).toEqual(['revoke:list-editor', 'grant:list-viewer']);
  });

  it('no prior role: only the new grant is dropped', async () => {
    const grant = jest.fn();
    const revoke = jest.fn();
    _setAuthzClientForTesting({ ...makeNoOpProxy(), grant, revoke } as any);
    await restoreAuthority({
      ...base,
      op: 'put',
      prior: null,
      target: 'list-viewer',
      writes: { revokeAttempted: false, grantAttempted: true },
    });
    expect(revoke).toHaveBeenCalledWith({ subject: 'usr_a', tenant: ORG, role: 'list-viewer', resource }, 'm');
    expect(grant).not.toHaveBeenCalled();
  });

  it('re-asserting the role the user already has (target === prior) is not undone', async () => {
    const grant = jest.fn();
    const revoke = jest.fn();
    _setAuthzClientForTesting({ ...makeNoOpProxy(), grant, revoke } as any);
    await restoreAuthority({
      ...base,
      op: 'put',
      prior: 'list-viewer',
      target: 'list-viewer',
      writes: { revokeAttempted: false, grantAttempted: true },
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it('nothing attempted -> nothing done', async () => {
    const grant = jest.fn();
    const revoke = jest.fn();
    _setAuthzClientForTesting({ ...makeNoOpProxy(), grant, revoke } as any);
    await restoreAuthority({
      ...base,
      op: 'delete',
      prior: 'list-viewer',
      target: null,
      writes: { revokeAttempted: false, grantAttempted: false },
    });
    expect(grant).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('a step that fails does not stop the next one, never throws, and is counted as outcome=failed', async () => {
    const grant = jest.fn().mockResolvedValue({});
    const revoke = jest.fn().mockRejectedValue(new Error('502'));
    _setAuthzClientForTesting({ ...makeNoOpProxy(), grant, revoke } as any);
    const failed = await counter(authzCompensationTotal, { op: 'put', outcome: 'failed' });
    const restored = await counter(authzCompensationTotal, { op: 'put', outcome: 'restored' });

    await expect(
      restoreAuthority({
        ...base,
        op: 'put',
        prior: 'list-viewer',
        target: 'list-editor',
        writes: { revokeAttempted: true, grantAttempted: true },
      }),
    ).resolves.toBeUndefined();

    expect(grant).toHaveBeenCalled(); // the re-grant still ran
    expect(await counter(authzCompensationTotal, { op: 'put', outcome: 'failed' })).toBe(failed + 1);
    expect(await counter(authzCompensationTotal, { op: 'put', outcome: 'restored' })).toBe(restored + 1);
  });
});

describe('revokeInstanceGrants', () => {
  const grants = [
    { user_id: 'usr_a', role: 'list-owner' },
    { user_id: 'usr_b', role: 'list-viewer' },
    { user_id: 'usr_c', role: 'list-editor' },
  ];
  const q = { orgId: ORG, listId: LIST, grants, token: 'm', cause: 'purge' as const, log };

  it('revokes each grant scoped to the instance and reports the tally', async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    _setAuthzClientForTesting({ ...makeNoOpProxy(), revoke } as any);
    expect(await revokeInstanceGrants(q)).toEqual({ revoked: 3, failed: [] });
    expect(revoke).toHaveBeenCalledWith(
      { subject: 'usr_b', tenant: ORG, role: 'list-viewer', resource: { type: 'SelectionList', key: LIST } },
      'm',
    );
  });

  it('never throws; failures are returned (for repair) and counted, and the rest are still attempted', async () => {
    const revoke = jest.fn(async (r: any) => {
      if (r.subject === 'usr_b') throw new Error('502');
    });
    _setAuthzClientForTesting({ ...makeNoOpProxy(), revoke } as any);
    const before = await counter(grantCleanupFailedTotal, { cause: 'purge' });
    const out = await revokeInstanceGrants(q);
    expect(out.revoked).toBe(2);
    expect(out.failed).toEqual([{ user_id: 'usr_b', role: 'list-viewer' }]);
    expect(revoke).toHaveBeenCalledTimes(3);
    expect(await counter(grantCleanupFailedTotal, { cause: 'purge' })).toBe(before + 1);
  });
});
