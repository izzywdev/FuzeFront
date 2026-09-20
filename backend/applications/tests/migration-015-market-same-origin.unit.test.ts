/**
 * Unit tests for migrations/015_market_same_origin_federated_remote.ts.
 */

import { up } from '../src/migrations/015_market_same_origin_federated_remote'

type AppRow = {
  id: string
  slug: string
  status?: string
  integration_type?: string | null
  remote_url?: string | null
  url?: string | null
  scope?: string | null
  module?: string | null
  manifest: any
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
            if (col !== 'slug') throw new Error(`unexpected lookup column: ${col}`)
            return [...table.values()].find(r => r.slug === val)
          },
          update: async (patch: Record<string, unknown>) => {
            if (col !== 'id') throw new Error(`unexpected update column: ${col}`)
            updateCalls.push({ id: val, patch })
            Object.assign(table.get(val)!, patch)
            return 1
          },
        }
      },
    }
  }
  return { knex: knex as any, updateCalls, table }
}

function manifestOf(row: AppRow): any {
  return typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
}

const CORRECT_ENTRY = '/apps/market/remoteEntry.js'
const STALE_INTERNAL = 'https://fuzemarket.fuze.internal/dist/remoteEntry.js'

describe('015 market same-origin federated remote repair', () => {
  it('repairs market row pointing at stale fuzemarket.fuze.internal URL', async () => {
    const marketRow: AppRow = {
      id: 'app_market_1',
      slug: 'market',
      status: 'activated',
      integration_type: 'module-federation',
      remote_url: STALE_INTERNAL,
      url: STALE_INTERNAL,
      scope: 'fuzemarket',
      module: './App',
      manifest: {
        name: 'Market',
        integration: {
          type: 'module-federation',
          remoteEntry: STALE_INTERNAL,
          scope: 'fuzemarket',
          module: './App',
        },
        routing: { path: '/app/market' },
      },
    }

    const { knex, updateCalls, table } = makeFakeKnex([marketRow])
    await up(knex)

    expect(updateCalls).toHaveLength(1)
    const updated = table.get('app_market_1')!
    expect(updated.remote_url).toBe(CORRECT_ENTRY)
    expect(updated.url).toBe(CORRECT_ENTRY)
    expect(updated.scope).toBe('market')
    const parsedManifest = manifestOf(updated)
    expect(parsedManifest.integration.remoteEntry).toBe(CORRECT_ENTRY)
    expect(parsedManifest.integration.scope).toBe('market')
  })

  it('suspends stranded orphan fuzemarket row when canonical market is activated', async () => {
    const marketRow: AppRow = {
      id: 'app_market_1',
      slug: 'market',
      status: 'activated',
      integration_type: 'module-federation',
      remote_url: CORRECT_ENTRY,
      url: CORRECT_ENTRY,
      scope: 'market',
      manifest: {
        integration: { remoteEntry: CORRECT_ENTRY, scope: 'market' },
      },
    }
    const orphanRow: AppRow = {
      id: 'app_fuzemarket_old',
      slug: 'fuzemarket',
      status: 'activated',
      manifest: {},
    }

    const { knex, updateCalls, table } = makeFakeKnex([marketRow, orphanRow])
    await up(knex)

    const orphanUpdated = table.get('app_fuzemarket_old')!
    expect(orphanUpdated.status).toBe('suspended')
  })
})
