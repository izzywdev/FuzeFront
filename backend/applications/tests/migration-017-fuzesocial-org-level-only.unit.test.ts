/**
 * Unit tests for migrations/017_fuzesocial_org_level_only.ts.
 */

import { up } from '../src/migrations/017_fuzesocial_org_level_only'

type AppRow = {
  id: string
  slug: string
  status?: string
  scope_level?: string
  visibility?: string
  manifest: any
  updated_at?: Date
}

type InstallationRow = {
  id: string
  app_id: string
  scope: string
  install_mode: string
}

function makeFakeKnex(apps: AppRow[], installations: InstallationRow[] = []) {
  const appsTable = new Map<string, AppRow>(apps.map(r => [r.id, r]))
  let instRows = [...installations]

  function knex(tableName: string) {
    if (tableName === 'apps') {
      return {
        where(col: string, val: string) {
          return {
            first: async () => {
              if (col !== 'slug') throw new Error(`unexpected lookup col: ${col}`)
              return [...appsTable.values()].find(r => r.slug === val)
            },
            update: async (patch: Record<string, unknown>) => {
              if (col !== 'id') throw new Error(`unexpected update col: ${col}`)
              Object.assign(appsTable.get(val)!, patch)
              return 1
            },
          }
        },
      }
    }

    if (tableName === 'app_installations') {
      return {
        where(col: string, val: string) {
          return {
            andWhere(cb: (b: any) => void) {
              const orClauses: Array<{ col: string; val: string }> = []
              const b = {
                where(c: string, v: string) {
                  orClauses.push({ col: c, val: v })
                  return {
                    orWhere(c2: string, v2: string) {
                      orClauses.push({ col: c2, val: v2 })
                      return this
                    },
                  }
                },
              }
              cb(b)
              return {
                del: async () => {
                  const initialCount = instRows.length
                  instRows = instRows.filter(row => {
                    if (row.app_id !== val) return true
                    const matchesOr = orClauses.some(
                      clause => row[clause.col as keyof InstallationRow] === clause.val
                    )
                    return !matchesOr
                  })
                  return initialCount - instRows.length
                },
              }
            },
          }
        },
      }
    }

    throw new Error(`unexpected table: ${tableName}`)
  }

  knex.schema = {
    hasTable: async (tableName: string) => tableName === 'app_installations' || tableName === 'apps',
  }

  return { knex, appsTable, getInstRows: () => instRows }
}

describe('migration 017_fuzesocial_org_level_only', () => {
  it('updates fuzesocial row to scope_level: organization, installMode: everyone, orgLevelOnly: true and revokes non-org or self installs', async () => {
    const apps: AppRow[] = [
      {
        id: 'app-social-1',
        slug: 'fuzesocial',
        scope_level: 'both',
        visibility: 'organization',
        manifest: JSON.stringify({
          slug: 'fuzesocial',
          name: 'FuzeSocial',
          visibility: 'organization',
        }),
      },
    ]

    const installations: InstallationRow[] = [
      { id: 'inst-1', app_id: 'app-social-1', scope: 'personal', install_mode: 'self' },
      { id: 'inst-2', app_id: 'app-social-1', scope: 'organization', install_mode: 'self' },
      { id: 'inst-3', app_id: 'app-social-1', scope: 'organization', install_mode: 'everyone' },
    ]

    const { knex, appsTable, getInstRows } = makeFakeKnex(apps, installations)

    await up(knex as any)

    const updatedApp = appsTable.get('app-social-1')!
    expect(updatedApp.scope_level).toBe('organization')
    expect(updatedApp.visibility).toBe('organization')

    const manifest = JSON.parse(updatedApp.manifest)
    expect(manifest.scopeLevel).toBe('organization')
    expect(manifest.requiresOrgContext).toBe(true)
    expect(manifest.installMode).toBe('everyone')
    expect(manifest.orgLevelOnly).toBe(true)

    // inst-1 (personal) and inst-2 (self) must be deleted; inst-3 (everyone) must remain
    const remaining = getInstRows()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('inst-3')
  })
})
