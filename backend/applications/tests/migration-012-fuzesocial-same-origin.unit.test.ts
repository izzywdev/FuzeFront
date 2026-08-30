/**
 * Unit tests for migrations/012_fuzesocial_same_origin_federated_remote.ts —
 * the FuzeFront half of the FuzeSocial iframe → same-origin module-federation
 * conversion (companion to izzywdev/FuzeSocial's packages/fuzesocial-ui remote
 * + deploy/helm/fuzesocial remote-ingress; extends the 008/009 same-origin
 * family, but this row changes integration TYPE, not just its URL).
 *
 * No DB, no network — pure unit tests using an in-memory fake knex builder
 * that supports exactly the two call shapes the migration issues:
 *   knex('apps').where('slug', slug).first()
 *   knex('apps').where('id', id).update(patch)
 */

import { up } from '../src/migrations/012_fuzesocial_same_origin_federated_remote'

type AppRow = {
  id: string
  slug: string
  integration_type: string | null
  remote_url: string | null
  url: string | null
  scope?: string | null
  module?: string | null
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

const IFRAME_URL = 'https://social.prod.fuzefront.com'
const SAME_ORIGIN = '/apps/fuzesocial/remoteEntry.js'

function fuzesocialRow(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: 'app-1',
    slug: 'fuzesocial',
    integration_type: 'iframe',
    remote_url: null,
    url: IFRAME_URL,
    scope: null,
    module: null,
    manifest: {
      slug: 'fuzesocial',
      integration: { type: 'iframe', url: IFRAME_URL },
    },
    ...overrides,
  }
}

describe('migration 012: fuzesocial iframe → same-origin federated remote', () => {
  test('converts a known iframe row to module-federation across columns and manifest', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([fuzesocialRow()])

    await up(knex)

    const row = table.get('app-1')!
    expect(row.integration_type).toBe('module-federation')
    expect(row.url).toBe(SAME_ORIGIN)
    expect(row.remote_url).toBe(SAME_ORIGIN)
    expect(row.scope).toBe('fuzesocial')
    expect(row.module).toBe('./App')

    const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    expect(manifest.integration).toEqual({
      type: 'module-federation',
      remoteEntry: SAME_ORIGIN,
      scope: 'fuzesocial',
      module: './App',
    })
    // The old iframe url key is dropped, not left dangling alongside remoteEntry.
    expect(manifest.integration.url).toBeUndefined()
    expect(updateCalls).toHaveLength(1)
  })

  test('does not touch slug', async () => {
    const { knex, table } = makeFakeKnex([fuzesocialRow()])
    await up(knex)
    expect(table.get('app-1')!.slug).toBe('fuzesocial')
  })

  test('no-op when no fuzesocial row exists (fresh DB, builtins.ts seeds it directly)', async () => {
    const { knex, updateCalls } = makeFakeKnex([])
    await expect(up(knex)).resolves.toBeUndefined()
    expect(updateCalls).toHaveLength(0)
  })

  test('idempotent: re-running after the row is already federated at the target is a no-op', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzesocialRow({
        integration_type: 'module-federation',
        remote_url: SAME_ORIGIN,
        url: SAME_ORIGIN,
        scope: 'fuzesocial',
        module: './App',
        manifest: {
          slug: 'fuzesocial',
          integration: { type: 'module-federation', remoteEntry: SAME_ORIGIN, scope: 'fuzesocial', module: './App' },
        },
      }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.integration_type).toBe('module-federation')
  })

  test('leaves an operator-customised iframe url untouched (unrecognised host)', async () => {
    const customUrl = 'https://social-mirror.example.com'
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzesocialRow({ url: customUrl, manifest: { slug: 'fuzesocial', integration: { type: 'iframe', url: customUrl } } }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.integration_type).toBe('iframe')
    expect(table.get('app-1')!.url).toBe(customUrl)
  })

  test('leaves a row already migrated to a different federated type alone', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzesocialRow({ integration_type: 'web-component', url: SAME_ORIGIN, remote_url: SAME_ORIGIN }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(0)
    expect(table.get('app-1')!.integration_type).toBe('web-component')
  })

  test('handles a manifest stored as a JSON string (jsonb round-trip) and rewrites it', async () => {
    const { knex, table } = makeFakeKnex([
      fuzesocialRow({
        manifest: JSON.stringify({ slug: 'fuzesocial', integration: { type: 'iframe', url: IFRAME_URL } }),
      }),
    ])

    await up(knex)

    const row = table.get('app-1')!
    const parsed = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
    expect(parsed.integration.type).toBe('module-federation')
    expect(parsed.integration.remoteEntry).toBe(SAME_ORIGIN)
  })

  test('rewrites columns but does not crash when manifest jsonb is unreadable', async () => {
    const { knex, table } = makeFakeKnex([fuzesocialRow({ manifest: '{not valid json' })])

    await expect(up(knex)).resolves.toBeUndefined()

    const row = table.get('app-1')!
    expect(row.integration_type).toBe('module-federation')
    expect(row.remote_url).toBe(SAME_ORIGIN)
    expect(row.scope).toBe('fuzesocial')
  })

  test('accepts the http (non-prod) social host too', async () => {
    const { knex, table, updateCalls } = makeFakeKnex([
      fuzesocialRow({ url: 'https://social.fuzefront.com/', manifest: { slug: 'fuzesocial', integration: { type: 'iframe', url: 'https://social.fuzefront.com/' } } }),
    ])

    await up(knex)

    expect(updateCalls).toHaveLength(1)
    expect(table.get('app-1')!.integration_type).toBe('module-federation')
  })
})
