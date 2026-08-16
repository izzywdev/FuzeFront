import { describe, it, expect } from 'vitest'
import { classifyOrgKind } from './orgKind'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

describe('classifyOrgKind', () => {
  it('classifies the platform root as root', () => {
    expect(classifyOrgKind({ id: ROOT_ID, parentId: null }, ROOT_ID)).toBe('root')
  })

  it('classifies a direct child of root as a portal', () => {
    expect(classifyOrgKind({ id: 'org_northwind', parentId: ROOT_ID }, ROOT_ID)).toBe('portal')
  })

  it('classifies a child of a non-root org as a sub-org', () => {
    expect(classifyOrgKind({ id: 'org_nw_sales', parentId: 'org_northwind' }, ROOT_ID)).toBe('sub-org')
  })

  it('classifies a top-level org with no parent as org', () => {
    expect(classifyOrgKind({ id: 'org_acme', parentId: null }, ROOT_ID)).toBe('org')
  })

  it('falls back to org when rootOrgId is unknown', () => {
    expect(classifyOrgKind({ id: 'org_acme', parentId: null })).toBe('org')
  })
})
