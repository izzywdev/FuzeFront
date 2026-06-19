import path from 'path'
import { Client } from 'pg'
import { runMigrations } from '@fuzefront/core'

// Integration test: security-service runs the original 001-009 chain against the
// existing knex_migrations table. 002 and 006 are no-op tombstones, so the apps
// table + app_visibility_enum must NOT be created here (applications-service owns
// them). Re-running migrations is a clean no-op. Requires a reachable Postgres;
// skips otherwise so unit CI without a DB still passes.
const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_mig_test'

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try {
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    return true
  } catch {
    return false
  }
}

describe('security-service migrations (integration)', () => {
  let reachable = false

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return
    process.env.USE_POSTGRES = 'true'
    process.env.NODE_ENV = 'production' // run compiled .js migrations from dist
    process.env.DB_HOST = HOST
    process.env.DB_PORT = String(PORT)
    process.env.DB_USER = USER
    process.env.DB_PASSWORD = PASSWORD
    process.env.DB_NAME = TEST_DB
    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
    await admin.query(`CREATE DATABASE ${TEST_DB}`)
    await admin.end()
  }, 60000)

  const migDir = path.join(__dirname, '..', 'dist', 'migrations')

  it('applies the 001-009 chain, then is a clean no-op on re-run', async () => {
    if (!reachable) {
      console.warn('Postgres unreachable — skipping security migration integration test')
      return
    }
    const opts = { migrationsTableName: 'knex_migrations', migrationsDir: migDir }
    await expect(runMigrations(opts)).resolves.toBeUndefined()
    await expect(runMigrations(opts)).resolves.toBeUndefined()

    const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB })
    await c.connect()
    const appsReg = await c.query("SELECT to_regclass('public.apps') AS a")
    const enumRow = await c.query("SELECT 1 FROM pg_type WHERE typname='app_visibility_enum'")
    const orgs = await c.query("SELECT to_regclass('public.organizations') AS a")
    const users = await c.query("SELECT to_regclass('public.users') AS a")
    await c.end()

    // 002/006 tombstoned: apps DDL must NOT exist in security's chain.
    expect(appsReg.rows[0].a).toBeNull()
    expect(enumRow.rowCount).toBe(0)
    // Security owns these.
    expect(orgs.rows[0].a).not.toBeNull()
    expect(users.rows[0].a).not.toBeNull()
  }, 60000)
})
