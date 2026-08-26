import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SubOrgTree } from './SubOrgTree'

describe('SubOrgTree', () => {
  it('renders nothing when there are no sub-orgs', () => {
    const { container } = render(<SubOrgTree nodes={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders each sub-org with a branch glyph and its role', () => {
    render(
      <SubOrgTree
        nodes={[
          { item: { id: 'org_nw_sales', name: 'Sales', role: 'admin' }, children: [] },
          { item: { id: 'org_nw_ops', name: 'Operations', role: 'viewer' }, children: [] },
        ]}
      />
    )
    const list = screen.getByText('Sales').closest('[data-list="sub-orgs"]')
    expect(list).toBeInTheDocument()
    expect(screen.getByText('Sales').closest('[data-org]')).toHaveAttribute('data-org', 'org_nw_sales')
    expect(screen.getByText('Sales').closest('[data-role]')).toHaveAttribute('data-role', 'admin')
  })
})
