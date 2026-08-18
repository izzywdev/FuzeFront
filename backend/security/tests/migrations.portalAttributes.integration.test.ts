import path from 'path'
import { Client } from 'pg'
import { runMigrations } from '@fuzefront/core'

/**
 * FF-EPIC-17-S7 — integration test for migration 016 (`organization_portal_attributes`).
 * Runs the FULL 001-016 chain against a scratch database, then re-runs it to
 * prove idempotency (the "run twice" requirement) — mirrors
 * `migrations.integration.test.ts`'s pattern exactly. Requires a reachable
 * Postgres; skips otherwise so unit CI without a DB still passes.
 */
const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_portal_attrs_mig_test'

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

describe('migration 016 — organization_portal_attributes (integration)', () => {
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

  it('creates the table + enums on a scratch DB, then is a clean idempotent no-op on re-run', async () => {
    if (!reachable) {
      console.warn('Postgres unreachable — skipping portal-attributes migration integration test')
      return
    }
    const opts = { migrationsTableName: 'knex_migrations', migrationsDir: migDir }

    // First run.
    await expect(runMigrations(opts)).resolves.toBeUndefined()

    const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB })
    await c.connect()

    const tableReg = await c.query("SELECT to_regclass('public.organization_portal_attributes') AS t")
    expect(tableReg.rows[0].t).not.toBeNull()

    const statusEnum = await c.query("SELECT 1 FROM pg_type WHERE typname='org_portal_attr_status_enum'")
    const billingEnum = await c.query("SELECT 1 FROM pg_type WHERE typname='org_portal_attr_billing_mode_enum'")
    const catalogEnum = await c.query("SELECT 1 FROM pg_type WHERE typname='org_portal_attr_app_catalog_mode_enum'")
    expect(statusEnum.rowCount).toBe(1)
    expect(billingEnum.rowCount).toBe(1)
    expect(catalogEnum.rowCount).toBe(1)

    // The old standalone `portals` table must be untouched (this migration
    // is additive-only) — it simply must not exist in the security-service's
    // own chain (it's owned by the monolith's migrations, not this service's).
    const legacyPortalsReg = await c.query("SELECT to_regclass('public.portals') AS t")
    expect(legacyPortalsReg.rows[0].t).toBeNull()

    const cols = await c.query(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organization_portal_attributes'
      ORDER BY column_name
    `)
    const colNames = cols.rows.map((r: { column_name: string }) => r.column_name).sort()
    expect(colNames).toEqual(
      [
        'app_catalog_mode',
        'billing_mode',
        'branding',
        'created_at',
        'custom_domain',
        'is_portal_root',
        'organization_id',
        'owner_email',
        'status',
        'updated_at',
      ].sort()
    )

    const orgIdCol = cols.rows.find((r: { column_name: string }) => r.column_name === 'organization_id')
    expect(orgIdCol.is_nullable).toBe('NO')

    // Idempotency: insert a probe row using the FK against the seeded root
    // org, re-run the FULL chain, and confirm the row and schema survive
    // unharmed (a non-idempotent migration would either error re-running or
    // silently wipe data).
    const rootRow = await c.query("SELECT id FROM organizations LIMIT 1")
    if (rootRow.rowCount && rootRow.rowCount > 0) {
      await c.query(
        `INSERT INTO organization_portal_attributes (organization_id, status) VALUES ($1, 'active')
         ON CONFLICT (organization_id) DO NOTHING`,
        [rootRow.rows[0].id]
      )
    }
    await c.end()

    // Second run — must be a clean no-op.
    await expect(runMigrations(opts)).resolves.toBeUndefined()

    const c2 = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB })
    await c2.connect()
    const tableReg2 = await c2.query("SELECT to_regclass('public.organization_portal_attributes') AS t")
    expect(tableReg2.rows[0].t).not.toBeNull()
    if (rootRow.rowCount && rootRow.rowCount > 0) {
      const probe = await c2.query(
        'SELECT status FROM organization_portal_attributes WHERE organization_id = $1',
        [rootRow.rows[0].id]
      )
      expect(probe.rowCount).toBe(1)
      expect(probe.rows[0].status).toBe('active')
    }
    await c2.end()
  }, 60000)
})
