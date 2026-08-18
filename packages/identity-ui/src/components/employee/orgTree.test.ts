import { describe, it, expect } from 'vitest'
import { mapEmployeeOrgKind, assembleEmployeeOrgTree } from './orgTree'
import type { EmployeeOrgListItem } from '../../api/employeeClient'

describe('mapEmployeeOrgKind', () => {
  it('maps the server root kind straight through', () => {
    expect(mapEmployeeOrgKind('root', 0)).toBe('root')
  })

  it('maps the server portal kind straight through, regardless of depth', () => {
    expect(mapEmployeeOrgKind('portal', 1)).toBe('portal')
    expect(mapEmployeeOrgKind('portal', 3)).toBe('portal')
  })

  it('maps a depth-1 organization (direct child of root) to org', () => {
    expect(mapEmployeeOrgKind('organization', 1)).toBe('org')
  })

  it('maps a deeper organization (nested under a non-root org) to sub-org', () => {
    expect(mapEmployeeOrgKind('organization', 2)).toBe('sub-org')
  })
})

function node(partial: Partial<EmployeeOrgListItem> & Pick<EmployeeOrgListItem, 'orgId' | 'name'>): EmployeeOrgListItem {
  return { parentOrgId: null, kind: 'organization', depth: 0, ...partial }
}

describe('assembleEmployeeOrgTree', () => {
  it('assembles a flat page-walked list into pre-order tree rows', () => {
    const items: EmployeeOrgListItem[] = [
      node({ orgId: 'org_nw_sales', name: 'Sales', parentOrgId: 'org_northwind', kind: 'organization', depth: 2 }),
      node({ orgId: 'org_root', name: 'FuzeFront', parentOrgId: null, kind: 'root', depth: 0 }),
      node({ orgId: 'org_northwind', name: 'Northwind', parentOrgId: 'org_root', kind: 'portal', depth: 1 }),
    ]
    const tree = assembleEmployeeOrgTree(items)
    expect(tree.map(n => n.id)).toEqual(['org_root', 'org_northwind', 'org_nw_sales'])
    expect(tree[0]).toMatchObject({ id: 'org_root', kind: 'root', parentId: null })
    expect(tree[1]).toMatchObject({ id: 'org_northwind', kind: 'portal', parentId: 'org_root' })
    expect(tree[2]).toMatchObject({ id: 'org_nw_sales', kind: 'sub-org', parentId: 'org_northwind' })
  })

  it('sorts siblings by name for a deterministic order', () => {
    const items: EmployeeOrgListItem[] = [
      node({ orgId: 'org_root', name: 'FuzeFront', parentOrgId: null, kind: 'root', depth: 0 }),
      node({ orgId: 'org_zed', name: 'Zed Co', parentOrgId: 'org_root', kind: 'organization', depth: 1 }),
      node({ orgId: 'org_acme', name: 'Acme Co', parentOrgId: 'org_root', kind: 'organization', depth: 1 }),
    ]
    const tree = assembleEmployeeOrgTree(items)
    expect(tree.map(n => n.id)).toEqual(['org_root', 'org_acme', 'org_zed'])
  })

  it('carries memberCount through untouched, undefined when the server omits it', () => {
    const items: EmployeeOrgListItem[] = [
      node({ orgId: 'org_root', name: 'FuzeFront', kind: 'root', depth: 0, memberCount: 12 }),
      node({ orgId: 'org_acme', name: 'Acme Co', parentOrgId: 'org_root', kind: 'organization', depth: 1 }),
    ]
    const tree = assembleEmployeeOrgTree(items)
    expect(tree.find(n => n.id === 'org_root')?.memberCount).toBe(12)
    expect(tree.find(n => n.id === 'org_acme')?.memberCount).toBeUndefined()
  })

  it('the real empty case (only root reachable) yields a single root row', () => {
    const items: EmployeeOrgListItem[] = [node({ orgId: 'org_root', name: 'FuzeFront', kind: 'root', depth: 0 })]
    expect(assembleEmployeeOrgTree(items)).toEqual([
      { id: 'org_root', name: 'FuzeFront', kind: 'root', parentId: null, memberCount: undefined },
    ])
  })

  it('still renders an item whose declared parent is missing from the page walk, rather than dropping it', () => {
    const items: EmployeeOrgListItem[] = [
      node({ orgId: 'org_orphan', name: 'Orphan Co', parentOrgId: 'org_missing', kind: 'organization', depth: 1 }),
    ]
    const tree = assembleEmployeeOrgTree(items)
    expect(tree.map(n => n.id)).toEqual(['org_orphan'])
  })

  it('returns an empty list for an empty input', () => {
    expect(assembleEmployeeOrgTree([])).toEqual([])
  })
})
