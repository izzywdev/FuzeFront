import { describe, it, expect } from 'vitest'
import { buildOrgForest, flattenForest } from './orgTree'
import type { OrgContextItem } from '../../types'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

const items: OrgContextItem[] = [
  { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
  { id: 'org_northwind', name: 'Northwind', role: 'owner', isPortal: true, parentId: ROOT_ID },
  { id: 'org_nw_sales', name: 'Sales', role: 'admin', parentId: 'org_northwind' },
  { id: 'org_nw_ops', name: 'Operations', role: 'viewer', parentId: 'org_northwind' },
  { id: 'org_acme', name: 'Acme Co', role: 'viewer', parentId: null },
]

describe('buildOrgForest', () => {
  it('matches 03-switcher / 04-my-orgs: root, Northwind, Acme as siblings; Sales/Ops nested under Northwind', () => {
    const forest = buildOrgForest(items, ROOT_ID)
    expect(forest.map(n => n.item.id)).toEqual([ROOT_ID, 'org_northwind', 'org_acme'])
    const northwind = forest.find(n => n.item.id === 'org_northwind')!
    expect(northwind.children.map(c => c.item.id)).toEqual(['org_nw_sales', 'org_nw_ops'])
  })

  it('root always sorts first even when listed elsewhere in the input', () => {
    const shuffled = [items[4], items[1], items[2], items[3], items[0]]
    const forest = buildOrgForest(shuffled, ROOT_ID)
    expect(forest[0].item.id).toBe(ROOT_ID)
  })

  it('never nests a row under the root — root is always a peer, not a parent', () => {
    const forest = buildOrgForest(items, ROOT_ID)
    const root = forest.find(n => n.item.id === ROOT_ID)!
    expect(root.children).toEqual([])
  })

  it('an org whose parent is not in the direct-membership list renders top-level (inherited access has no row)', () => {
    // org_nw_sales's parent (org_northwind) is absent — Sales must NOT
    // silently vanish or crash; it becomes a top-level row.
    const withoutParent = items.filter(i => i.id !== 'org_northwind')
    const forest = buildOrgForest(withoutParent, ROOT_ID)
    expect(forest.map(n => n.item.id)).toEqual([ROOT_ID, 'org_nw_sales', 'org_nw_ops', 'org_acme'])
  })

  it('handles an empty list', () => {
    expect(buildOrgForest([], ROOT_ID)).toEqual([])
  })

  it('flattenForest round-trips every item depth-first', () => {
    const forest = buildOrgForest(items, ROOT_ID)
    const flat = flattenForest(forest)
    expect(flat.map(i => i.id).sort()).toEqual(items.map(i => i.id).sort())
  })
})
