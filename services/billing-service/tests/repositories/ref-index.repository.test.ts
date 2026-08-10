/**
 * Unit tests for PgRefIndexRepository against a fake pg.Pool (no live Postgres).
 *
 * The SQL here carries the correctness of the L1 projection (FFRNT-184), so
 * these assert the clauses that are easy to drop and impossible to notice:
 *   - upsert refuses to resurrect a tombstoned row (Kafka redelivers, and gives
 *     no ordering across partitions)
 *   - markDeleted INSERTs rather than UPDATEs, because a delete can legitimately
 *     arrive before the create was ever observed
 *   - the existence read is scoped to status='active'
 *   - every write stamps liveness, which is what lets the read path tell
 *     "absent" apart from "the projection has not caught up"
 */
import { PgRefIndexRepository } from '../../src/repositories/ref-index.repository';

function fakePool(queryImpl: jest.Mock) {
  return { query: queryImpl } as any;
}

const UUID = '0195a8f2-6c3d-7f11-8b2a-2c9f4d1e7a01';

describe('PgRefIndexRepository.has', () => {
  it('only counts ACTIVE rows', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{}] });
    const repo = new PgRefIndexRepository(fakePool(query));

    await expect(repo.has('user', UUID)).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/status = 'active'/);
    expect(params).toEqual(['user', UUID, null]);
  });

  it('reports absence when no row matches', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const repo = new PgRefIndexRepository(fakePool(query));
    await expect(repo.has('user', UUID)).resolves.toBe(false);
  });

  it('lets an UNSCOPED row answer a tenant-scoped question', async () => {
    // A platform user has no tenant. Requiring an exact tenant match both ways
    // would make every reference to one look absent.
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{}] });
    const repo = new PgRefIndexRepository(fakePool(query));

    await repo.has('user', UUID, 'org-1');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/tenant_id IS NULL OR tenant_id = \$3/);
    expect(params[2]).toBe('org-1');
  });
});

describe('PgRefIndexRepository.upsert', () => {
  it('is idempotent and never resurrects a tombstone', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repo = new PgRefIndexRepository(fakePool(query));

    await repo.upsert({
      entityType: 'user',
      entityId: UUID,
      tenantId: null,
      status: 'active',
    });

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT/);
    // Without this guard, a redelivered `*.created` arriving after the
    // `*.deleted` that supersedes it silently brings the entity back and the
    // projection starts vouching for something that is gone.
    expect(sql).toMatch(/WHERE billing\.ref_index\.status <> 'deleted'/);
  });

  it('stamps liveness on every write', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repo = new PgRefIndexRepository(fakePool(query));

    await repo.upsert({
      entityType: 'user',
      entityId: UUID,
      tenantId: null,
      status: 'active',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toMatch(/ref_index_state/);
  });
});

describe('PgRefIndexRepository.markDeleted', () => {
  it('INSERTs the tombstone rather than UPDATEing', async () => {
    // The delete can arrive before the create was ever observed — a compacted
    // topic, or a consumer that started late. A bare UPDATE would match nothing,
    // leave the entity merely unknown, and let the later create mark it active.
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repo = new PgRefIndexRepository(fakePool(query));

    await repo.markDeleted('user', UUID);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO billing\.ref_index/);
    expect(sql).toMatch(/DO UPDATE SET status = 'deleted'/);
  });
});

describe('PgRefIndexRepository state', () => {
  it('reports lastAppliedAt, and null when nothing has been applied', async () => {
    const when = new Date('2026-01-01T00:00:00Z');
    const withRow = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ last_applied_at: when }] });
    await expect(new PgRefIndexRepository(fakePool(withRow)).lastAppliedAt()).resolves.toBe(when);

    const empty = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(new PgRefIndexRepository(fakePool(empty)).lastAppliedAt()).resolves.toBeNull();
  });

  it('reports isEmpty, which is the signal to rebuild from the log', async () => {
    const empty = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(new PgRefIndexRepository(fakePool(empty)).isEmpty()).resolves.toBe(true);

    const full = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{}] });
    await expect(new PgRefIndexRepository(fakePool(full)).isEmpty()).resolves.toBe(false);
  });
});
