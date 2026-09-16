/**
 * Unit tests for migrations/014_clock_manifest_remoteentry_repair.ts.
 *
 * The defect 014 exists for is a GUARD defect, not a value defect: 010 already
 * had the right values and still left the row broken, because it decided on
 * `remote_url` while the host reads `manifest.integration.remoteEntry`. So the
 * central case here is the DISAGREEING row — column correct, manifest wrong —
 * which 010 explicitly declines to touch and 014 must repair.
 *
 * No DB, no network — an in-memory fake knex supporting exactly the two call
 * shapes the migration issues:
 *   knex('apps').where('slug', slug).first()
 *   knex('apps').where('id', id).update(patch)
 */

import { up } from '../src/migrations/014_clock_manifest_remoteentry_repair'

type AppRow = {
  id: string
  slug: string
  remote_url?: string
  url?: string
  manifest?: any
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

/** A jsonb write lands as a JSON string; service.ts parses it back the same way. */
function manifestOf(row: AppRow): any {
  return typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest
}

const CORRECT = '/apps/clock/remoteEntry.js'
const WRONG = '/apps/clock/assets/remoteEntry.js'

function clockRow(manifestEntry: string, remoteUrl: string): AppRow {
  return {
    id: 'app_clock',
    slug: 'clock',
    remote_url: remoteUrl,
    url: remoteUrl,
    manifest: { name: 'Clock', integration: { type: 'module-federation', remoteEntry: manifestEntry } },
  }
}

describe('014 clock manifest remoteEntry repair', () => {
  it('repairs the row 010 declines to touch: column already correct, manifest still wrong', async () => {
    // This is the production state measured on 2026-09-07 and the entire
    // reason 014 exists. 010 reads remote_url, finds it is not its literal
    // known-wrong string, and returns having changed nothing.
    const { knex, updateCalls, table } = makeFakeKnex([clockRow(WRONG, CORRECT)])
    await up(knex)
    expect(updateCalls).toHaveLength(1)
    expect(manifestOf(table.get('app_clock')!).integration.remoteEntry).toBe(CORRECT)
  })

  it('repairs the plain case: both manifest and column carry the wrong path', async () => {
    const { knex, updateCalls, table } = makeFakeKnex([clockRow(WRONG, WRONG)])
    await up(knex)
    expect(updateCalls).toHaveLength(1)
    const patch = updateCalls[0].patch
    expect(patch.remote_url).toBe(CORRECT)
    expect(patch.url).toBe(CORRECT)
    expect(manifestOf(table.get('app_clock')!).integration.remoteEntry).toBe(CORRECT)
  })

  it('repairs an ABSOLUTE url whose path is the known-wrong one', async () => {
    // 008 could store an absolute URL; only the path is diagnostic.
    const abs = 'https://app.fuzefront.com/apps/clock/assets/remoteEntry.js'
    const { knex, updateCalls, table } = makeFakeKnex([clockRow(abs, abs)])
    await up(knex)
    expect(updateCalls).toHaveLength(1)
    expect(manifestOf(table.get('app_clock')!).integration.remoteEntry).toBe(CORRECT)
  })

  it('is a no-op when the row is already correct, so re-running is safe', async () => {
    const { knex, updateCalls } = makeFakeKnex([clockRow(CORRECT, CORRECT)])
    await up(knex)
    expect(updateCalls).toHaveLength(0)
  })

  it('leaves an unrecognised entry alone — an operator may have re-pointed it', async () => {
    const custom = 'https://clock.internal.example/remoteEntry.js'
    const { knex, updateCalls, table } = makeFakeKnex([clockRow(custom, custom)])
    await up(knex)
    expect(updateCalls).toHaveLength(0)
    expect(manifestOf(table.get('app_clock')!).integration.remoteEntry).toBe(custom)
  })

  it('does nothing when clock is not registered at all', async () => {
    const { knex, updateCalls } = makeFakeKnex([])
    await up(knex)
    expect(updateCalls).toHaveLength(0)
  })

  it('never touches another app’s row', async () => {
    const other: AppRow = {
      id: 'app_other',
      slug: 'fuzequality',
      remote_url: WRONG,
      url: WRONG,
      manifest: { integration: { remoteEntry: WRONG } },
    }
    const { knex, updateCalls } = makeFakeKnex([other])
    await up(knex)
    expect(updateCalls).toHaveLength(0)
  })

  it('leaves a row with an UNREADABLE manifest alone, and logs it', async () => {
    // The host reads the manifest. Writing the columns for a row whose manifest
    // cannot be parsed would report a repair the host cannot see, so the row is
    // left for a re-register and the log says which row it was.
    const row: AppRow = { id: 'app_clock', slug: 'clock', remote_url: WRONG, url: WRONG, manifest: null }
    const { knex, updateCalls } = makeFakeKnex([row])
    const logs: string[] = []
    const spy = jest.spyOn(console, 'log').mockImplementation(m => void logs.push(String(m)))
    try {
      await up(knex)
    } finally {
      spy.mockRestore()
    }
    expect(updateCalls).toHaveLength(0)
    expect(logs.join('\n')).toMatch(/leaving untouched/)
  })

  it('accepts a manifest stored as a JSON STRING, not just an object', async () => {
    const row: AppRow = {
      id: 'app_clock',
      slug: 'clock',
      remote_url: WRONG,
      url: WRONG,
      manifest: JSON.stringify({ integration: { remoteEntry: WRONG } }),
    }
    const { knex, updateCalls } = makeFakeKnex([row])
    await up(knex)
    expect(updateCalls).toHaveLength(1)
    expect(JSON.parse(String(updateCalls[0].patch.manifest)).integration.remoteEntry).toBe(CORRECT)
  })
})
