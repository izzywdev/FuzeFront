/**
 * Real-Postgres integration test for migration 018 + knexBuildSessionStore.
 * Proves (a) migration 018's up() is genuinely re-runnable (not just tracked as
 * applied by knex), (b) the SQL the store emits is valid, the keyset cursor
 * walks the full set with no gaps/dupes, and the status CAS is race-safe.
 * Skips (loudly) when Postgres is unreachable, like the idempotency suite.
 */
import knexFactory, { Knex } from 'knex'
import { Client } from 'pg'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const DB = 'fuzefront_apps_builds_jest'

let testDb: Knex
jest.mock('../src/config/database', () => ({
  get db() {
    return (global as any).__buildTestDb
  },
}))

import { up } from '../src/migrations/018_app_creator_and_build_sessions'
import {
  knexBuildSessionStore as store,
  encodeSessionCursor,
  decodeSessionCursor,
} from '../src/app-registry/build-sessions'

const U1 = '10000000-0000-4000-8000-000000000001'
const U2 = '10000000-0000-4000-8000-000000000002'
const ORG = '20000000-0000-4000-8000-000000000001'
const PERSONAL = '20000000-0000-4000-8000-000000000002'
const APP = '30000000-0000-4000-8000-000000000001'

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try { await c.connect(); await c.query('SELECT 1'); await c.end(); return true } catch { return false }
}

describe('app_build_sessions store (real Postgres)', () => {
  let reachable = false

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) return
    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`)
    await admin.query(`CREATE DATABASE ${DB}`)
    await admin.end()
    testDb = knexFactory({
      client: 'pg',
      connection: { host: HOST, port: PORT, user: USER, password: PASSWORD, database: DB },
    })
    ;(global as any).__buildTestDb = testDb
    await testDb.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    await testDb.raw('CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid())')
    await testDb.raw(`CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, type text)`)
    await testDb.raw(`CREATE TABLE organization_memberships (
      user_id uuid, organization_id uuid, status text, role text)`)
    await testDb.raw(`CREATE TABLE apps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text, organization_id uuid)`)
    await testDb('users').insert([{ id: U1 }, { id: U2 }])
    await testDb('organizations').insert([
      { id: ORG, owner_id: U2, type: 'business' },
      { id: PERSONAL, owner_id: U1, type: 'personal' },
    ])
    await testDb('organization_memberships').insert({
      user_id: U1, organization_id: ORG, status: 'active', role: 'admin',
    })
    await testDb('apps').insert({ id: APP, slug: 'my-app', organization_id: ORG })
  }, 60000)

  afterAll(async () => {
    if (testDb) await testDb.destroy()
  })

  it('migration 018 up() is re-runnable (true idempotency)', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')
    await up(testDb)
    await up(testDb)
    const cols = await testDb.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='apps' AND column_name='created_by_user_id'"
    )
    expect(cols.rows[0].is_nullable).toBe('YES')
  })

  it('directory lookups: personal org, org role, org exists, app by slug', async () => {
    if (!reachable) return
    expect(await store.findPersonalOrgId(U1)).toBe(PERSONAL)
    expect(await store.findPersonalOrgId(U2)).toBeNull()
    expect(await store.getOrgRole(U1, ORG)).toBe('admin')
    expect(await store.getOrgRole(U2, ORG)).toBeNull()
    expect(await store.orgExists(ORG)).toBe(true)
    expect((await store.findAppBySlug('my-app'))?.id).toBe(APP)
  })

  it('inserts, joins app slug, and walks pages with no gaps/dupes (incl. equal created_at)', async () => {
    if (!reachable) return
    const base = Date.now()
    const ids: string[] = []
    for (let i = 0; i < 7; i++) {
      const id = `40000000-0000-4000-8000-00000000000${i}`
      ids.push(id)
      // i=3,4 share an identical created_at to exercise the id tiebreaker.
      const t = new Date(base + (i === 4 ? 3 : i) * 1000)
      await store.insert({
        id, organization_id: ORG, requested_by_user_id: U1, context: 'organization',
        name: `n${i}`, brief: 'b', status: 'building', app_id: i === 0 ? APP : null,
        agent_session_ref: null, agent_session_url: null, error_code: null, error_message: null,
        created_at: t, updated_at: t,
      })
    }
    expect((await store.findById(ids[0]))?.app_slug).toBe('my-app')

    const seen: string[] = []
    let cursor: { createdAt: string; id: string } | null = null
    for (let guard = 0; guard < 10; guard++) {
      const rows = await store.list({ requesterId: U1, limit: 3, includeAllInOrg: false, cursor })
      const hasMore = rows.length > 3
      const page = hasMore ? rows.slice(0, 3) : rows
      seen.push(...page.map(r => r.id))
      if (!hasMore) break
      cursor = decodeSessionCursor(encodeSessionCursor(page[page.length - 1]))
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })

  it('org-wide listing only widens for managers; own listing excludes others', async () => {
    if (!reachable) return
    const t = new Date()
    await store.insert({
      id: '50000000-0000-4000-8000-000000000001', organization_id: ORG, requested_by_user_id: U2,
      context: 'organization', name: 'other', brief: 'b', status: 'building', app_id: null,
      agent_session_ref: null, agent_session_url: null, error_code: null, error_message: null,
      created_at: t, updated_at: t,
    })
    const own = await store.list({ requesterId: U1, organizationId: ORG, includeAllInOrg: false, limit: 50 })
    expect(own.every(r => r.requested_by_user_id === U1)).toBe(true)
    const all = await store.list({ requesterId: U1, organizationId: ORG, includeAllInOrg: true, limit: 50 })
    expect(all.some(r => r.requested_by_user_id === U2)).toBe(true)
  })

  it('transition is a compare-and-set on status', async () => {
    if (!reachable) return
    const id = '40000000-0000-4000-8000-000000000001'
    expect(await store.transition(id, ['launching'], { status: 'deployed' })).toBe(false)
    expect(await store.transition(id, ['building'], { status: 'deploying' })).toBe(true)
    expect((await store.findById(id))?.status).toBe('deploying')
  })
})
