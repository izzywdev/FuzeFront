import { MEMBERSHIP_ROLE_RANK } from '../src/permit/schema'

// FFRNT-378 — the org switcher listed an org twice when a user held two
// `organization_memberships` rows for it. The fix (organizations.ts `GET /`)
// collapses to one row per org and keeps the HIGHEST-ranked role, with the
// ranking driven by MEMBERSHIP_ROLE_RANK (it also generates the SQL CASE used
// in the correlated subquery). This pure test locks that ranking so a reorder
// can't silently change which role wins the collapse.

// Mirror of the SQL `ORDER BY CASE … DESC LIMIT 1`: highest-ranked role wins.
const highestRole = (roles: string[]): string | null => {
  let best: string | null = null
  let bestRank = -1
  for (const r of roles) {
    const rank = MEMBERSHIP_ROLE_RANK[r as keyof typeof MEMBERSHIP_ROLE_RANK] ?? 0
    if (rank > bestRank) {
      bestRank = rank
      best = r
    }
  }
  return best
}

describe('membership role rank (FFRNT-378)', () => {
  it('ranks owner > admin > member > viewer > developer (strict, total order)', () => {
    const { owner, admin, member, viewer, developer } = MEMBERSHIP_ROLE_RANK
    expect(owner).toBeGreaterThan(admin)
    expect(admin).toBeGreaterThan(member)
    expect(member).toBeGreaterThan(viewer)
    expect(viewer).toBeGreaterThan(developer)
    // all ranks distinct — no ties, so the collapse is deterministic
    const ranks = Object.values(MEMBERSHIP_ROLE_RANK)
    expect(new Set(ranks).size).toBe(ranks.length)
  })

  it('breaks the owner/admin tie that MEMBERSHIP_TO_PERMIT_ROLE cannot', () => {
    // owner and admin both map to Permit `admin`; here owner must strictly win.
    expect(MEMBERSHIP_ROLE_RANK.owner).toBeGreaterThan(MEMBERSHIP_ROLE_RANK.admin)
  })

  it('collapses duplicate memberships to the highest effective role', () => {
    expect(highestRole(['viewer', 'owner'])).toBe('owner') // the FFRNT-378 case
    expect(highestRole(['owner', 'viewer'])).toBe('owner') // order-independent
    expect(highestRole(['member', 'admin'])).toBe('admin')
    expect(highestRole(['developer', 'viewer'])).toBe('viewer') // real org role beats dev marker
    expect(highestRole(['viewer'])).toBe('viewer')
    expect(highestRole([])).toBeNull()
  })

  it('covers exactly the five DB membership roles', () => {
    expect(Object.keys(MEMBERSHIP_ROLE_RANK).sort()).toEqual(
      ['admin', 'developer', 'member', 'owner', 'viewer']
    )
  })
})
