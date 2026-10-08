import { teardownPortalsForOrg } from '../src/services/portalTeardown'

/**
 * Unit tests for the portal-teardown reaction to identity.org.deleted
 * (FFRNT-174). A tiny in-memory fake `db` is injected via overrides — no real
 * Postgres, no broker. The Authentik redirect deregistrar is a spy.
 */

const ORG = 'org-1'

interface PortalRow {
  id: string
  organization_id: string
  is_root: boolean
  status: string
}
interface DomainRow {
  portal_id: string
  domain: string
}

function makeFakeDb(portals: PortalRow[], domains: DomainRow[]) {
  const updates: Array<{ id: any; patch: any }> = []
  const deletedPortals: string[] = []
  const deletedDomainsFor: string[] = []

  class Builder {
    private filters: Record<string, any> = {}
    constructor(private table: string) {}
    private rows(): any[] {
      const src = this.table === 'portals' ? portals : domains
      return src.filter(r =>
        Object.entries(this.filters).every(([k, v]) => (r as any)[k] === v)
      )
    }
    where(objOrCol: any, val?: any) {
      if (typeof objOrCol === 'object') Object.assign(this.filters, objOrCol)
      else this.filters[objOrCol] = val
      return this
    }
    andWhere(col: string, val: any) {
      this.filters[col] = val
      return this
    }
    async select(..._cols: string[]) {
      return this.rows().map(r => ({ ...r }))
    }
    async update(patch: any) {
      const matched = this.rows()
      for (const r of matched) {
        Object.assign(r, patch)
        updates.push({ id: r.id, patch })
      }
      return matched.length
    }
    async del() {
      const matched = this.rows()
      if (this.table === 'portals') {
        for (const r of matched) {
          deletedPortals.push(r.id)
          portals.splice(portals.indexOf(r), 1)
        }
      } else {
        for (const r of matched) {
          deletedDomainsFor.push(r.portal_id)
          domains.splice(domains.indexOf(r), 1)
        }
      }
      return matched.length
    }
  }

  const db = ((table: string) => new Builder(table)) as any
  return { db, updates, deletedPortals, deletedDomainsFor }
}

describe('teardownPortalsForOrg (FFRNT-174)', () => {
  it('soft cascade suspends non-root portals and never touches the root portal', async () => {
    const { db, updates } = makeFakeDb(
      [
        { id: 'prt_a', organization_id: ORG, is_root: false, status: 'active' },
        { id: 'prt_root', organization_id: ORG, is_root: true, status: 'active' },
      ],
      []
    )
    const deregisterRedirect = jest.fn()
    const res = await teardownPortalsForOrg(ORG, 'soft', { db, deregisterRedirect })
    expect(res).toEqual({ organizationId: ORG, cascade: 'soft', portalsAffected: 1 })
    expect(updates).toEqual([{ id: 'prt_a', patch: expect.objectContaining({ status: 'suspended' }) }])
    expect(deregisterRedirect).not.toHaveBeenCalled()
  })

  it('soft cascade is idempotent — no write when already suspended', async () => {
    const { db, updates } = makeFakeDb(
      [{ id: 'prt_a', organization_id: ORG, is_root: false, status: 'suspended' }],
      []
    )
    const res = await teardownPortalsForOrg(ORG, 'soft', { db, deregisterRedirect: jest.fn() })
    expect(res.portalsAffected).toBe(1)
    expect(updates).toEqual([])
  })

  it('hard cascade deregisters each domain then deletes domains + the portal row', async () => {
    const { db, deletedPortals, deletedDomainsFor } = makeFakeDb(
      [{ id: 'prt_a', organization_id: ORG, is_root: false, status: 'active' }],
      [
        { portal_id: 'prt_a', domain: 'a.example.com' },
        { portal_id: 'prt_a', domain: 'b.example.com' },
      ]
    )
    const deregisterRedirect = jest.fn().mockResolvedValue(undefined)
    const res = await teardownPortalsForOrg(ORG, 'hard', { db, deregisterRedirect })
    expect(res).toEqual({ organizationId: ORG, cascade: 'hard', portalsAffected: 1 })
    expect(deregisterRedirect.mock.calls.map(c => c[0])).toEqual(['a.example.com', 'b.example.com'])
    expect(deletedDomainsFor).toContain('prt_a')
    expect(deletedPortals).toEqual(['prt_a'])
  })

  it('hard cascade continues deleting when a redirect deregistration fails (best-effort)', async () => {
    const { db, deletedPortals } = makeFakeDb(
      [{ id: 'prt_a', organization_id: ORG, is_root: false, status: 'active' }],
      [{ portal_id: 'prt_a', domain: 'a.example.com' }]
    )
    const deregisterRedirect = jest.fn().mockRejectedValue(new Error('authentik down'))
    const res = await teardownPortalsForOrg(ORG, 'hard', { db, deregisterRedirect })
    expect(res.portalsAffected).toBe(1)
    expect(deletedPortals).toEqual(['prt_a'])
  })

  it('is a no-op when the org has no (non-root) portals', async () => {
    const { db, updates, deletedPortals } = makeFakeDb(
      [{ id: 'prt_root', organization_id: ORG, is_root: true, status: 'active' }],
      []
    )
    const deregisterRedirect = jest.fn()
    const res = await teardownPortalsForOrg(ORG, 'hard', { db, deregisterRedirect })
    expect(res.portalsAffected).toBe(0)
    expect(updates).toEqual([])
    expect(deletedPortals).toEqual([])
    expect(deregisterRedirect).not.toHaveBeenCalled()
  })
})
