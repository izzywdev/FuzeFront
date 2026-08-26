/**
 * Regression for #760 — the permit-schema-sync PostSync hook exited non-zero on
 * every deploy, which failed the Argo sync, which meant the weight-10 hooks
 * (including consumer-registration-seed, the job that writes the platform
 * registration token) never ran at all.
 *
 * The cause was not a database outage, which is what the failure was reported as.
 * `config/database` exports `export let db: Knex` — DECLARED at module load and
 * ASSIGNED only inside `initializeDatabaseConnection()`. The server calls that
 * during boot; the CLI entrypoint did not. So `db` was `undefined`, `db.schema`
 * threw a TypeError, and `loadRegisteredPolicyResult`'s catch classified it as
 * `registry_unavailable` — the state deliberately reserved for a REAL outage,
 * and deliberately fatal.
 *
 * These tests pin the two halves of that:
 *   1. the loader initializes the connection before touching `db`;
 *   2. it does not report `registry_unavailable` merely because nobody had
 *      initialized the handle yet.
 *
 * Both use a mocked `config/database` so no Postgres is required — the bug was
 * in initialization order, not in any query.
 */

const hasTable = jest.fn().mockResolvedValue(false)

jest.mock('../src/config/database', () => {
  const mod: Record<string, unknown> = {
    db: undefined,
    initializeDatabaseConnection: jest.fn(() => {
      // Mirrors the real module: the binding is only populated here.
      mod.db = Object.assign(() => ({}), { schema: { hasTable, hasColumn: jest.fn() } })
    }),
    // The ES module namespace object is read-only, so a test cannot clear `db`
    // through the import binding — reset it from inside the mock instead.
    __resetDb: () => {
      mod.db = undefined
    },
  }
  return mod
})

import { loadRegisteredPolicyResult } from '../src/permit/sync-permit-schema'
import * as database from '../src/config/database'

describe('#760 — permit-schema-sync initializes the DB before reading the app registry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(jest.requireMock('../src/config/database') as { __resetDb: () => void }).__resetDb()
  })

  it('calls initializeDatabaseConnection() before touching db.schema', async () => {
    await loadRegisteredPolicyResult(() => {})
    expect(database.initializeDatabaseConnection).toHaveBeenCalled()
    expect(hasTable).toHaveBeenCalledWith('apps')
  })

  it('does not report registry_unavailable just because the handle was uninitialized', async () => {
    const result = await loadRegisteredPolicyResult(() => {})

    // `available: false` is what the CLI job treats as fatal (exit 1). An
    // uninitialized handle is a setup bug in THIS process, not a registry
    // outage, and must never be reported as one.
    expect(result.available).toBe(true)
    expect(result.error).toBeNull()
  })
})
