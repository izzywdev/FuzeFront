import path from 'path'
import { Client } from 'pg'
import { runMigrations } from '@fuzefront/core'

// C1 — the highest-risk verification. applications-service migrations must run as
// a clean no-op against a DB that ALREADY has the apps table, app_visibility_enum,
// and all org-related columns (the state of every existing deployment, where the
// old monolith's migrations 002/006 already applied). The idempotent guards
// (hasTable / DO $$ EXCEPTION WHEN duplicate_object / hasColumn) must prevent any
// "already exists" / "duplicate column" crash. Skips if Postgres is unreachable.
const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const DB = 'fuzefront_apps_idem_jest'

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try { await c.connect(); await c.query('SELECT 1'); await c.end(); return true } catch { return false }
}

// Minimal pre-existing apps schema matching the old monolith's 002 + 006 output.
async function seedExistingAppsSchema(): Promise<void> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: DB })
  await c.connect()
  // organizations + users are referenced by FKs; create minimal versions.
  await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await c.query("CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid())")
  await c.query("CREATE TABLE IF NOT EXISTS organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid())")
  await c.query(`CREATE TABLE IF NOT EXISTS apps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar UNIQUE NOT NULL,
    url varchar NOT NULL,
    icon_url varchar,
    is_active boolean DEFAULT true,
    integration_type varchar DEFAULT 'iframe',
    remote_url varchar, scope varchar, module varchar, description text,
    metadata json,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
  )`)
  await c.query(`DO $$ BEGIN
    CREATE TYPE app_visibility_enum AS ENUM ('private','organization','public','marketplace');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
  await c.query(`ALTER TABLE apps
    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS visibility app_visibility_enum DEFAULT 'private',
    ADD COLUMN IF NOT EXISTS marketplace_metadata jsonb DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS is_marketplace_approved boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS marketplace_submitted_at timestamptz,
    ADD COLUMN IF NOT EXISTS marketplace_approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS install_permissions jsonb DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS install_count integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rating decimal(3,2),
    ADD COLUMN IF NOT EXISTS review_count integer DEFAULT 0`)
  await c.end()
}

describe('applications-service migrations idempotency (C1, integration)', () => {
  let reachable = false

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return
    process.env.USE_POSTGRES = 'true'
    process.env.NODE_ENV = 'production'
    process.env.DB_HOST = HOST
    process.env.DB_PORT = String(PORT)
    process.env.DB_USER = USER
    process.env.DB_PASSWORD = PASSWORD
    process.env.DB_NAME = DB
    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`)
    await admin.query(`CREATE DATABASE ${DB}`)
    await admin.end()
    await seedExistingAppsSchema()
  }, 60000)

  const migDir = path.join(__dirname, '..', 'dist', 'migrations')

  it('is a clean no-op against a pre-existing apps table/enum/columns', async () => {
    if (!reachable) {
      console.warn('Postgres unreachable — skipping applications idempotency test')
      return
    }
    const opts = { migrationsTableName: 'knex_migrations_apps', migrationsDir: migDir }
    // Must not throw despite the apps table + enum + columns already existing.
    await expect(runMigrations(opts)).resolves.toBeUndefined()
    await expect(runMigrations(opts)).resolves.toBeUndefined()

    const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: DB })
    await c.connect()
    const cols = await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='apps'"
    )
    await c.end()
    // Columns preserved (not dropped/duplicated).
    const names = cols.rows.map(r => r.column_name)
    expect(names).toContain('organization_id')
    expect(names).toContain('visibility')
    expect(names).toContain('install_count')
  }, 60000)
})
