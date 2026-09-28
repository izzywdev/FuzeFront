// Regression coverage for the stuck-migrations-lock self-heal in
// `runMigrations` (backend/core/src/config/database.ts).
//
// Why this exists: every schema-owning service (security-service,
// applications-service) calls `runMigrations` in-process at boot and runs
// `replicas: 2` in prod, so two pods race `migrate.latest()` on every
// restart. Knex's `migrations_lock` row has no staleness check — if a prior
// boot's migration process was killed mid-transaction (OOM, SIGKILL past
// terminationGracePeriodSeconds, node crash) rather than throwing cleanly,
// the lock is stuck FOREVER and every subsequent boot fails at "Migration
// table is already locked" instead of at any actual migration — turning a
// one-time failure into a permanent crash loop. See FuzeFront#902.
//
// The real knex migration engine (lock acquisition, transactions, an actual
// Postgres/sqlite migrations_lock table) is knex's own, already-tested
// machinery — not what this fix touches. What this fix adds is OUR
// catch/retry control flow around `migrate.latest()`, so the `knex` module
// is mocked here to exercise exactly that: a stuck-lock error, then a
// successful retry after force-freeing; a genuine unrelated migration error
// that must NOT be swallowed; and a retry that still fails, which must
// still propagate rather than looping forever.

const migrateLatestMock = jest.fn()
const forceFreeMigrationsLockMock = jest.fn()
const destroyMock = jest.fn()

jest.mock('knex', () => {
  const actual = jest.requireActual('knex')
  return {
    ...actual,
    knex: jest.fn(() => ({
      migrate: {
        latest: migrateLatestMock,
        forceFreeMigrationsLock: forceFreeMigrationsLockMock,
      },
      destroy: destroyMock,
    })),
  }
})

import { runMigrations } from '../../src/config/database'

describe('runMigrations — stuck migrations-lock self-heal', () => {
  beforeEach(() => {
    migrateLatestMock.mockReset()
    forceFreeMigrationsLockMock.mockReset().mockResolvedValue(undefined)
    destroyMock.mockReset().mockResolvedValue(undefined)
  })

  it('force-frees a stuck lock and retries exactly once, succeeding', async () => {
    migrateLatestMock
      .mockRejectedValueOnce(new Error('Migration table is already locked'))
      .mockResolvedValueOnce([1, ['001_init.js']])

    await expect(
      runMigrations({ migrationsTableName: 'knex_migrations_test' })
    ).resolves.toBeUndefined()

    expect(forceFreeMigrationsLockMock).toHaveBeenCalledTimes(1)
    expect(migrateLatestMock).toHaveBeenCalledTimes(2)
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('matches the "lock" phrasing case-insensitively without matching unrelated errors', async () => {
    migrateLatestMock
      .mockRejectedValueOnce(new Error('MIGRATION TABLE IS ALREADY LOCKED'))
      .mockResolvedValueOnce([2, []])

    await expect(runMigrations()).resolves.toBeUndefined()
    expect(forceFreeMigrationsLockMock).toHaveBeenCalledTimes(1)
  })

  it('does not mask a genuine, non-lock migration error', async () => {
    migrateLatestMock.mockRejectedValueOnce(new Error('column "foo" does not exist'))

    await expect(
      runMigrations({ migrationsTableName: 'knex_migrations_test' })
    ).rejects.toThrow('column "foo" does not exist')

    expect(forceFreeMigrationsLockMock).not.toHaveBeenCalled()
    expect(migrateLatestMock).toHaveBeenCalledTimes(1)
    // Still cleans up its connection even on failure.
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('propagates the error if the retry after force-freeing still fails (no infinite loop)', async () => {
    migrateLatestMock
      .mockRejectedValueOnce(new Error('Migration table is already locked'))
      .mockRejectedValueOnce(new Error('Migration table is already locked'))

    await expect(
      runMigrations({ migrationsTableName: 'knex_migrations_test' })
    ).rejects.toThrow('already locked')

    expect(forceFreeMigrationsLockMock).toHaveBeenCalledTimes(1)
    expect(migrateLatestMock).toHaveBeenCalledTimes(2)
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })
})
