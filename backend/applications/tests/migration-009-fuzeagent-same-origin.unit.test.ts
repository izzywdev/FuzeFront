/**
 * Unit tests for migrations/009_fuzeagent_same_origin_federated_remote.ts —
 * the FuzeFront half of the FuzeAgent same-origin federation fix
 * (companion to izzywdev/FuzeAgent#184; extends
 * 008_same_origin_federated_remotes.ts, which shipped fuzequality + clock
 * but left fuzeagent out).
 *
 * No DB, no network — pure unit tests using an in-memory fake knex builder
 * that supports exactly the two call shapes the migration issues:
 *   knex('apps').where('slug', slug).first()
 *   knex('apps').where('id', id).update(patch)
 */

import { up } from '../src/migrations/009_fuzeagent_same_origin_federated_remote'

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

const CROSS_ORIGIN = 'https://fuzeagent.prod.fuzefront.com/remoteEntry.js'
const SAME_ORIGIN = '/apps/fuzeagent/remoteEntry.js'

function fuzeagentRow(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: 'app-1',
    slug: 'fuzeagent',
    remote_url: CROSS_ORIGIN,
    url: CROSS_ORIGIN,
    manifest: {
      slug: 'fuzeagent',
      integration: { type: 'module-federation', remoteEntry: CROSS_ORIGIN, scope: 'fuzeagentApp' },
    },
    ...overrides,
  }
}

describe('migration 009: fuzeagent same-origin federated remote', () => {
  test('rewrites remote_url, url, and manifest.integration.remoteEntry for a known cross-origin row', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([fuzeagentRow()])

    await up(knex)

    const row = table.get('app-1')!
    expect(row.remote_url).toBe(SAME_ORIGIN)
    expect(row.url).toBe(SAME_ORIGIN)
    // The update patch re-serialises manifest back to a JSON string (matching
    // the jsonb column), mirroring how 008 persists it.
    const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    expect(manifest.integration.remoteEntry).toBe(SAME_ORIGIN)
    expect(updateCalls).toHaveLength(1)
  })

  test('does not touch slug', async () => {
    const { knex, table } = makeFakeKnex([fuzeagentRow()])
    await up(knex)
    expect(table.get('app-1')!.slug).toBe('fuzeagent')
  })

  test('is a no-op when no fuzeagent row exists (fresh DB, builtins.ts seeds it directly)', async () => {
    const { knex, updateCalls } = makeFakeKnex([])
    await expect(up(knex)).resolves.toBeUndefined()
    expect(updateCalls).toHaveLength(0)
  })

  test('idempotent: re-running after the row is already same-origin is a no-op', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzeagentRow({ remote_url: SAME_ORIGIN, url: SAME_ORIGIN }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.remote_url).toBe(SAME_ORIGIN)
  })

  test('leaves an operator-customised remote_url untouched (unrecognised host)', async () => {
    const customUrl = 'https://custom-fuzeagent-mirror.example.com/remoteEntry.js'
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzeagentRow({ remote_url: customUrl, url: customUrl }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.remote_url).toBe(customUrl)
  })

  test('leaves an already-relative remote_url untouched even if not exactly the target path', async () => {
    // Relative paths never match REWRITABLE_HOST (which is anchored on http(s)://),
    // so an operator-relocated relative remote is never clobbered.
    const relative = '/apps/fuzeagent-canary/remoteEntry.js'
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzeagentRow({ remote_url: relative, url: relative }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.remote_url).toBe(relative)
  })

  test('does not rewrite unrelated apps (only touches slug=fuzeagent)', async () => {
    const otherCrossOrigin = 'https://fuzequality.prod.fuzefront.com/remoteEntry.js'
    const { knex, table, updateCalls } = makeFakeKnex([
      { id: 'app-2', slug: 'fuzequality', remote_url: otherCrossOrigin, url: otherCrossOrigin, manifest: null },
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-2')!.remote_url).toBe(otherCrossOrigin)
  })

  test('handles a manifest stored as a JSON string (jsonb round-trip) and updates it', async () => {
    const { knex, table } = makeFakeKnex([
      fuzeagentRow({
        manifest: JSON.stringify({
          slug: 'fuzeagent',
          integration: { type: 'module-federation', remoteEntry: CROSS_ORIGIN, scope: 'fuzeagentApp' },
        }),
      }),
    ])

    await up(knex)

    const row = table.get('app-1')!
    // Migration re-serialises the manifest back to a JSON string for the update patch.
    const parsed = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    expect(parsed.integration.remoteEntry).toBe(SAME_ORIGIN)
  })

  test('rewrites columns but does not crash when manifest jsonb is unreadable', async () => {
    const { knex, table } = makeFakeKnex([fuzeagentRow({ manifest: '{not valid json' })])

    await expect(up(knex)).resolves.toBeUndefined()

    const row = table.get('app-1')!
    expect(row.remote_url).toBe(SAME_ORIGIN)
    expect(row.url).toBe(SAME_ORIGIN)
  })
})
