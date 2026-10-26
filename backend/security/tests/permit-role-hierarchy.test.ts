import {
  permitSchema,
  PERMIT_TENANT_ROLE_CHAIN,
  MEMBERSHIP_TO_PERMIT_ROLE,
  DEFAULT_PERMIT_ROLE,
} from '../src/permit/schema'

// FFRNT-376 — the tenant-role hierarchy is a CONTRACT, not an incidental
// property of three hand-written lists: owner/admin ⊇ member/editor ⊇ viewer,
// with `developer` deliberately orthogonal. These assertions fail CI the moment
// the inclusion is broken — e.g. a permission added to a lower role but not the
// higher one, or a higher role edited in a way that drops a lower role's perm.
// This is the security-service (canonical authz surface) copy of the schema;
// the monolith copy is guarded by the identical test in backend/tests/.

const permsOf = (key: string): string[] => {
  const role = permitSchema.roles.find((r) => r.key === key)
  if (!role) throw new Error(`role ${key} missing from permitSchema`)
  return role.permissions
}

describe('permit tenant-role hierarchy (FFRNT-376)', () => {
  it('each higher role in the chain is a strict superset of the one below', () => {
    for (let i = 1; i < PERMIT_TENANT_ROLE_CHAIN.length; i++) {
      const lower = PERMIT_TENANT_ROLE_CHAIN[i - 1]
      const higher = PERMIT_TENANT_ROLE_CHAIN[i]
      const lowerPerms = new Set(permsOf(lower))
      const higherPerms = new Set(permsOf(higher))
      const missing = [...lowerPerms].filter((p) => !higherPerms.has(p))
      expect(missing).toEqual([]) // higher ⊇ lower
      expect(higherPerms.size).toBeGreaterThan(lowerPerms.size) // strict
    }
  })

  it('no composed role carries a duplicate permission', () => {
    for (const role of permitSchema.roles) {
      expect(role.permissions.length).toBe(new Set(role.permissions).size)
    }
  })

  it('developer is OUTSIDE the chain — disjoint from viewer, not a superset', () => {
    const viewer = new Set(permsOf('viewer'))
    const developer = new Set(permsOf('developer'))
    const shared = [...viewer].filter((p) => developer.has(p))
    expect(shared).toEqual([]) // disjoint from viewer
    expect(PERMIT_TENANT_ROLE_CHAIN as readonly string[]).not.toContain('developer')
  })

  it('maps DB membership roles to Permit tenant roles with owner⊇admin collapsed at the top', () => {
    expect(MEMBERSHIP_TO_PERMIT_ROLE.owner).toBe('admin')
    expect(MEMBERSHIP_TO_PERMIT_ROLE.admin).toBe('admin')
    expect(MEMBERSHIP_TO_PERMIT_ROLE.member).toBe('editor')
    expect(MEMBERSHIP_TO_PERMIT_ROLE.viewer).toBe('viewer')
    expect(MEMBERSHIP_TO_PERMIT_ROLE.developer).toBe('developer')
    // every mapped target (and the default) is a real role in the schema
    for (const target of Object.values(MEMBERSHIP_TO_PERMIT_ROLE)) {
      expect(permitSchema.roles.some((r) => r.key === target)).toBe(true)
    }
    expect(permitSchema.roles.some((r) => r.key === DEFAULT_PERMIT_ROLE)).toBe(true)
  })

  it('every role in the inclusion chain is reachable from at least one DB membership role', () => {
    const targets = new Set(Object.values(MEMBERSHIP_TO_PERMIT_ROLE))
    for (const role of PERMIT_TENANT_ROLE_CHAIN) {
      expect(targets.has(role)).toBe(true)
    }
  })
})
