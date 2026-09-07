/**
 * Unit tests for migrations/013_suspend_stranded_duplicate_app_rows.ts — the
 * removal of the duplicate FuzeSales / FuzeService tiles from the portal menu.
 *
 * The guards are the point of these tests, not the happy path. Suspending an
 * orphan when the canonical row is absent or itself suspended would leave a
 * product with NO tile, which is strictly worse than the duplicate this
 * migration exists to remove.
 *
 * No DB, no network — an in-memory fake knex supporting exactly the two call
 * shapes the migration issues:
 *   knex('apps').where('slug', slug).first()
 *   knex('apps').where('id', id).update(patch)
 */

import {
  up,
  down,
} from '../src/migrations/013_suspend_stranded_duplicate_app_rows'

type AppRow = {
  id: string
  slug: string
  status: string
  builtin?: boolean
  updated_at?: Date
}

function makeFakeKnex(rows: AppRow[]) {
  const table = new Map<string, AppRow>(rows.map(r => [r.id, r]))
  const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = []

  function knex(tableName: string) {
    if (tableName !== 'apps') throw new Error(`unexpected table: ${tableName}`)

    return {
      where(col: string, val: string) {
        return {
          first: async () => {
            if (col !== 'slug')
              throw new Error(`unexpected where col in first(): ${col}`)
            return [...table.values()].find(r => r.slug === val)
          },
          update: async (patch: Record<string, unknown>) => {
            if (col !== 'id')
              throw new Error(`unexpected where col in update(): ${col}`)
            const row = table.get(val)
            if (!row) return 0
            Object.assign(row, patch)
            updateCalls.push({ id: val, patch })
            return 1
          },
        }
      },
    }
  }

  return { knex: knex as any, table, updateCalls }
}

const bySlug = (t: Map<string, AppRow>, slug: string) =>
  [...t.values()].find(r => r.slug === slug)

/** The four rows the live registry actually held on 2026-09-07. */
function liveShape(): AppRow[] {
  return [
    { id: 'a1', slug: 'sales', status: 'activated' },
    { id: 'a2', slug: 'fuzesales', status: 'activated' },
    { id: 'a3', slug: 'service', status: 'activated' },
    { id: 'a4', slug: 'fuzeservice', status: 'activated' },
  ]
}

describe('013 suspend stranded duplicate app rows', () => {
  it('suspends both orphans when both canonical rows are activated', async () => {
    const { knex, table, updateCalls } = makeFakeKnex(liveShape())

    await up(knex)

    expect(bySlug(table, 'fuzesales')!.status).toBe('suspended')
    expect(bySlug(table, 'fuzeservice')!.status).toBe('suspended')
    expect(updateCalls).toHaveLength(2)
  })

  it('never touches the canonical rows', async () => {
    const { knex, table } = makeFakeKnex(liveShape())

    await up(knex)

    expect(bySlug(table, 'sales')!.status).toBe('activated')
    expect(bySlug(table, 'service')!.status).toBe('activated')
  })

  it('never edits a slug, in either direction', async () => {
    const { knex, updateCalls } = makeFakeKnex(liveShape())

    await up(knex)

    for (const call of updateCalls) {
      expect(Object.keys(call.patch).sort()).toEqual(['status', 'updated_at'])
    }
  })

  it('leaves the orphan alone when the canonical row is ABSENT', async () => {
    // Suspending here would leave FuzeSales with no tile at all.
    const { knex, table, updateCalls } = makeFakeKnex([
      { id: 'a2', slug: 'fuzesales', status: 'activated' },
      { id: 'a3', slug: 'service', status: 'activated' },
      { id: 'a4', slug: 'fuzeservice', status: 'activated' },
    ])

    await up(knex)

    expect(bySlug(table, 'fuzesales')!.status).toBe('activated')
    expect(updateCalls.map(c => c.id)).toEqual(['a4'])
  })

  it('leaves the orphan alone when the canonical row is itself suspended', async () => {
    const rows = liveShape()
    rows.find(r => r.slug === 'service')!.status = 'suspended'
    const { knex, table } = makeFakeKnex(rows)

    await up(knex)

    expect(bySlug(table, 'fuzeservice')!.status).toBe('activated')
    // The unaffected pair still resolves.
    expect(bySlug(table, 'fuzesales')!.status).toBe('suspended')
  })

  it('leaves a builtin orphan alone — ensureBuiltins() would fight the change', async () => {
    const rows = liveShape()
    rows.find(r => r.slug === 'fuzeservice')!.builtin = true
    const { knex, table } = makeFakeKnex(rows)

    await up(knex)

    expect(bySlug(table, 'fuzeservice')!.status).toBe('activated')
  })

  it('is idempotent — a second run issues no writes', async () => {
    const { knex, updateCalls } = makeFakeKnex(liveShape())

    await up(knex)
    const afterFirst = updateCalls.length
    await up(knex)

    expect(updateCalls).toHaveLength(afterFirst)
  })

  it('does nothing when neither orphan row exists', async () => {
    const { knex, updateCalls } = makeFakeKnex([
      { id: 'a1', slug: 'sales', status: 'activated' },
      { id: 'a3', slug: 'service', status: 'activated' },
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
  })

  it('down() restores both tiles', async () => {
    const { knex, table } = makeFakeKnex(liveShape())

    await up(knex)
    await down(knex)

    expect(bySlug(table, 'fuzesales')!.status).toBe('activated')
    expect(bySlug(table, 'fuzeservice')!.status).toBe('activated')
  })

  it('down() does not reactivate a row suspended by someone else', async () => {
    // Only rows this migration would have suspended are eligible; a row that was
    // never suspended must not be flipped, and one already activated stays put.
    const rows = liveShape()
    const { knex, table, updateCalls } = makeFakeKnex(rows)

    await down(knex)

    expect(updateCalls).toHaveLength(0)
    expect(bySlug(table, 'fuzesales')!.status).toBe('activated')
  })
})
