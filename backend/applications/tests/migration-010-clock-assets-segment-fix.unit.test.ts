/**
 * Unit tests for migrations/010_clock_remoteentry_assets_segment_fix.ts —
 * corrects the erroneous `/assets/` segment 008_same_origin_federated_remotes.ts
 * baked into the built-in `clock` app's remoteEntry.
 *
 * No DB, no network — pure unit tests using an in-memory fake knex builder
 * that supports exactly the two call shapes the migration issues:
 *   knex('apps').where('slug', slug).first()
 *   knex('apps').where('id', id).update(patch)
 */

import { up } from '../src/migrations/010_clock_remoteentry_assets_segment_fix'

type AppRow = {
  id: string
  slug: string
  remote_url: string | null
  url: string | null
  manifest: any
  updated_at?: Date
}

function makeFakeKnex(rows: AppRow[]) {
  const table = new Map<string, AppRow>(rows.map((r) => [r.id, r]))
  const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = []

  function knex(tableName: string) {
    if (tableName !== 'apps') throw new Error(`unexpected table: ${tableName}`)

    return {
      where(col: string, val: string) {
        return {
          first: async () => {
            if (col !== 'slug') throw new Error(`unexpected where col in first(): ${col}`)
            return [...table.values()].find((r) => r.slug === val)
          },
          update: async (patch: Record<string, unknown>) => {
            if (col !== 'id') throw new Error(`unexpected where col in update(): ${col}`)
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

const WRONG_ENTRY = '/apps/clock/assets/remoteEntry.js'
const CORRECT_ENTRY = '/apps/clock/remoteEntry.js'

function clockRow(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: 'app-1',
    slug: 'clock',
    remote_url: WRONG_ENTRY,
    url: WRONG_ENTRY,
    manifest: {
      slug: 'clock',
      integration: { type: 'module-federation', remoteEntry: WRONG_ENTRY, scope: 'clockApp' },
    },
    ...overrides,
  }
}

describe('migration 010: clock remoteEntry assets-segment fix', () => {
  test('rewrites remote_url, url, and manifest.integration.remoteEntry for the known-wrong value', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([clockRow()])

    await up(knex)

    const row = table.get('app-1')!
    expect(row.remote_url).toBe(CORRECT_ENTRY)
    expect(row.url).toBe(CORRECT_ENTRY)
    const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    expect(manifest.integration.remoteEntry).toBe(CORRECT_ENTRY)
    expect(updateCalls).toHaveLength(1)
  })

  test('does not touch slug', async () => {
    const { knex, table } = makeFakeKnex([clockRow()])
    await up(knex)
    expect(table.get('app-1')!.slug).toBe('clock')
  })

  test('is a no-op when no clock row exists (fresh DB, builtins.ts seeds it directly)', async () => {
    const { knex, updateCalls } = makeFakeKnex([])
    await expect(up(knex)).resolves.toBeUndefined()
    expect(updateCalls).toHaveLength(0)
  })

  test('idempotent: re-running after the row is already correct is a no-op', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([
      clockRow({ remote_url: CORRECT_ENTRY, url: CORRECT_ENTRY }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.remote_url).toBe(CORRECT_ENTRY)
  })

  test('leaves an operator-customised remote_url untouched', async () => {
    const customUrl = '/apps/clock-canary/remoteEntry.js'
    const { knex, table, updateCalls } = makeFakeKnex([
      clockRow({ remote_url: customUrl, url: customUrl }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.remote_url).toBe(customUrl)
  })

  test('does not rewrite unrelated apps (only touches slug=clock)', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([
      {
        id: 'app-2',
        slug: 'fuzequality',
        remote_url: '/apps/fuzequality/assets/remoteEntry.js',
        url: '/apps/fuzequality/assets/remoteEntry.js',
        manifest: null,
      },
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-2')!.remote_url).toBe('/apps/fuzequality/assets/remoteEntry.js')
  })

  test('handles a manifest stored as a JSON string (jsonb round-trip) and updates it', async () => {
    const { knex, table } = makeFakeKnex([
      clockRow({
        manifest: JSON.stringify({
          slug: 'clock',
          integration: { type: 'module-federation', remoteEntry: WRONG_ENTRY, scope: 'clockApp' },
        }),
      }),
    ])

    await up(knex)

    const row = table.get('app-1')!
    const parsed = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    expect(parsed.integration.remoteEntry).toBe(CORRECT_ENTRY)
  })

  test('rewrites columns but does not crash when manifest jsonb is unreadable', async () => {
    const { knex, table } = makeFakeKnex([clockRow({ manifest: '{not valid json' })])

    await expect(up(knex)).resolves.toBeUndefined()

    const row = table.get('app-1')!
    expect(row.remote_url).toBe(CORRECT_ENTRY)
    expect(row.url).toBe(CORRECT_ENTRY)
  })
})
