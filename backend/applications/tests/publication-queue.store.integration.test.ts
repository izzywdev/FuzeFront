/**
 * Real-Postgres integration test for AppRegistryService.listPublicationRequests
 * (GET /publication-requests) + migration 019. Proves (a) the SQL is valid and
 * returns each status's queue oldest-first, (b) the opaque keyset cursor walks
 * the FULL set with no gaps/dupes — including rows sharing an identical
 * timestamp and a row inserted mid-walk, (c) a cursor is bound to its status,
 * (d) migration 019 is re-runnable and the pending partial index is created.
 * Skips (loudly) when Postgres is unreachable, like the sibling suites.
 */
import knexFactory, { Knex } from 'knex'
import { Client } from 'pg'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const DB = 'fuzefront_apps_pubqueue_jest'

let testDb: Knex
jest.mock('../src/config/database', () => ({
  get db() {
    return (global as any).__pubQueueTestDb
  },
}))

import { up as up019, down as down019 } from '../src/migrations/019_marketplace_publication_queue_index'
import { appRegistryService, InvalidCursorError } from '../src/app-registry/service'

const ORG = '20000000-0000-4000-8000-000000000001'

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try { await c.connect(); await c.query('SELECT 1'); await c.end(); return true } catch { return false }
}

const manifest = (slug: string) =>
  JSON.stringify({ manifestVersion: '1', slug, name: `App ${slug}`, menuLabel: slug, mode: 'portal', visibility: 'private' })

let seq = 0
async function seed(slug: string, extra: Record<string, unknown> = {}) {
  await testDb('apps').insert({
    id: `30000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    slug,
    organization_id: ORG,
    status: 'registered',
    mode: 'portal',
    builtin: false,
    manifest: manifest(slug),
    is_marketplace_approved: false,
    marketplace_metadata: '{}',
    ...extra,
  })
}

async function walk(status: 'pending' | 'approved' | 'rejected', limit: number, between?: () => Promise<void>) {
  const slugs: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await appRegistryService.listPublicationRequests({ status, limit, cursor })
    slugs.push(...page.items.map(i => i.app.slug))
    cursor = page.nextCursor ?? undefined
    expect(page.hasMore).toBe(Boolean(page.nextCursor))
    pages++
    if (between && pages === 1) await between()
  } while (cursor)
  return { slugs, pages }
}

describe('publication review queue (real Postgres)', () => {
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
    ;(global as any).__pubQueueTestDb = testDb
    // Only the columns the queue reads (the real table is built by 001-006/018).
    await testDb.raw(`CREATE TABLE apps (
      id uuid PRIMARY KEY,
      slug text NOT NULL,
      organization_id uuid,
      status text,
      mode text,
      builtin boolean DEFAULT false,
      manifest jsonb,
      created_by_user_id uuid,
      marketplace_metadata jsonb DEFAULT '{}',
      is_marketplace_approved boolean DEFAULT false,
      marketplace_submitted_at timestamptz,
      marketplace_approved_at timestamptz,
      approved_by uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )`)

    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const at = (s: number) => new Date(t0 + s * 1000)
    // pending: p3,p4 share an identical submittedAt (slug tiebreak); inserted out of order.
    await seed('p5', { marketplace_submitted_at: at(50) })
    await seed('p1', { marketplace_submitted_at: at(10) })
    await seed('p4', { marketplace_submitted_at: at(30) })
    await seed('p3', { marketplace_submitted_at: at(30) })
    await seed('p2', { marketplace_submitted_at: at(20) })
    await seed('p6', { marketplace_submitted_at: at(60) })
    await seed('p7', { marketplace_submitted_at: at(70) })
    // approved: ordered by approval time; a0 is a legacy row with no approvedAt.
    await seed('a2', { is_marketplace_approved: true, marketplace_submitted_at: at(200), marketplace_approved_at: at(300), created_at: at(1) })
    await seed('a1', { is_marketplace_approved: true, marketplace_submitted_at: at(100), marketplace_approved_at: at(400), created_at: at(1) })
    await seed('a0', { is_marketplace_approved: true, marketplace_submitted_at: at(5), marketplace_approved_at: null, created_at: at(350) })
    // rejected (submission cleared; ordered by rejectedAt); r-none has none -> excluded everywhere.
    await seed('r2', { marketplace_metadata: JSON.stringify({ publication: { rejection: { reason: 'x', rejectedAt: at(2000).toISOString() } } }) })
    await seed('r1', { marketplace_metadata: JSON.stringify({ publication: { rejection: { reason: 'y', rejectedAt: at(1000).toISOString() } } }) })
    await seed('r-bad', { marketplace_metadata: JSON.stringify({ publication: { rejection: { reason: 'z', rejectedAt: 'garbage' } } }), created_at: at(5) })
    await seed('none1')
  }, 60000)

  afterAll(async () => {
    if (testDb) await testDb.destroy()
  })

  it('pending: oldest first by submittedAt, slug tiebreak; excludes approved/rejected/none', async () => {
    if (!reachable) return console.warn('Postgres unreachable — skipping')
    const page = await appRegistryService.listPublicationRequests({ status: 'pending', limit: 50 })
    expect(page.items.map(i => i.app.slug)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
    expect(page.items[0].publication.submittedAt).toBe('2026-01-01T00:00:10.000Z')
  })

  it('pending: cursor walks the full set with no gaps/dupes (limit 2 -> 4 pages; limit 1; limit 3)', async () => {
    if (!reachable) return
    for (const limit of [1, 2, 3]) {
      const { slugs } = await walk('pending', limit)
      expect(slugs).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
    }
    expect((await walk('pending', 2)).pages).toBe(4)
  })

  it('pending: a row submitted after page 1 appears exactly once, a decided row is not duplicated', async () => {
    if (!reachable) return
    const { slugs } = await walk('pending', 3, async () => {
      await seed('late', { marketplace_submitted_at: new Date('2026-01-02T00:00:00.000Z') })
    })
    expect(slugs).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'late'])
    expect(new Set(slugs).size).toBe(slugs.length)
    await testDb('apps').where('slug', 'late').del()
  })

  it('pending: sub-millisecond timestamps never duplicate or skip a row across a page boundary (limit 1)', async () => {
    if (!reachable) return
    // Same millisecond, different microseconds (and one exactly-on-ms row): with a
    // bare-column sort the boundary row compared GREATER than its own ms-truncated
    // cursor and was returned on two consecutive pages. Truncation makes them
    // equal-at-ms, ordered by slug.
    for (const [slug, ts] of [
      ['us-c', '2026-01-03 00:00:00.123900+00'],
      ['us-a', '2026-01-03 00:00:00.123456+00'],
      ['us-b', '2026-01-03 00:00:00.123789+00'],
      ['us-d', '2026-01-03 00:00:00.124000+00'],
    ]) {
      await seed(slug, { marketplace_submitted_at: testDb.raw('?::timestamptz', [ts]) })
    }
    try {
      for (const limit of [1, 2, 3]) {
        const { slugs } = await walk('pending', limit)
        expect(slugs).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'us-a', 'us-b', 'us-c', 'us-d'])
        expect(new Set(slugs).size).toBe(slugs.length)
      }
    } finally {
      await testDb('apps').whereIn('slug', ['us-a', 'us-b', 'us-c', 'us-d']).del()
    }
  })

  it('limit is clamped server-side to the max (over-max request does not error or exceed 200)', async () => {
    if (!reachable) return
    const page = await appRegistryService.listPublicationRequests({ status: 'pending', limit: 100000 })
    expect(page.items.length).toBeLessThanOrEqual(200)
    expect(page.items).toHaveLength(7)
  })

  it('approved: ordered by approvedAt (NOT submission), legacy row with no approvedAt falls back to created_at; cursor walks it', async () => {
    if (!reachable) return
    // a1 submitted first but approved LAST; a2 submitted later, approved earlier;
    // a0 has no approvedAt -> created_at (+350s, between a2 +300s and a1 +400s).
    const { slugs } = await walk('approved', 1)
    expect(slugs).toEqual(['a2', 'a0', 'a1'])
    expect((await walk('approved', 2)).slugs).toEqual(['a2', 'a0', 'a1'])
  })

  it('rejected: ordered by recorded rejectedAt; malformed rejectedAt falls back to created_at (no cast error)', async () => {
    if (!reachable) return
    const { slugs } = await walk('rejected', 1)
    expect(slugs).toEqual(['r-bad', 'r1', 'r2'])
  })

  it('a cursor is bound to its status and malformed cursors are rejected', async () => {
    if (!reachable) return
    const first = await appRegistryService.listPublicationRequests({ status: 'pending', limit: 1 })
    expect(first.nextCursor).toBeTruthy()
    await expect(
      appRegistryService.listPublicationRequests({ status: 'approved', cursor: first.nextCursor! })
    ).rejects.toBeInstanceOf(InvalidCursorError)
    for (const bad of ['!!!', 'bm9wZQ', Buffer.from('pq1|pending|not-a-date|x').toString('base64url')]) {
      await expect(
        appRegistryService.listPublicationRequests({ status: 'pending', cursor: bad })
      ).rejects.toBeInstanceOf(InvalidCursorError)
    }
  })

  it('migration 019 is re-runnable, creates the pending partial index, and the query can use it', async () => {
    if (!reachable) return
    await up019(testDb)
    await up019(testDb)
    const idx = await testDb.raw(
      "SELECT indexdef FROM pg_indexes WHERE tablename='apps' AND indexname='apps_marketplace_pending_queue_idx'"
    )
    expect(idx.rows).toHaveLength(1)
    expect(idx.rows[0].indexdef).toMatch(/marketplace_submitted_at, slug/)
    expect(idx.rows[0].indexdef).toMatch(/WHERE/)
    // The pending query's predicate is written to match the partial index, so the
    // planner can use it (seq scan disabled: the fixture table is too small to
    // prefer an index on cost alone).
    const plan = await testDb.transaction(async trx => {
      await trx.raw('SET LOCAL enable_seqscan = off')
      const r = await trx.raw(
        `EXPLAIN SELECT * FROM apps
           WHERE marketplace_submitted_at IS NOT NULL AND COALESCE(is_marketplace_approved, false) = false
           ORDER BY date_trunc('milliseconds', marketplace_submitted_at) ASC, slug ASC LIMIT 51`
      )
      return r.rows.map((x: any) => x['QUERY PLAN']).join('\n')
    })
    expect(plan).toMatch(/apps_marketplace_pending_queue_idx/)
    await down019(testDb)
    await down019(testDb)
    const gone = await testDb.raw("SELECT 1 FROM pg_indexes WHERE indexname='apps_marketplace_pending_queue_idx'")
    expect(gone.rows).toHaveLength(0)
    await up019(testDb)
  })
})
