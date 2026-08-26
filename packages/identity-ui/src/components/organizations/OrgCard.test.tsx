import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrgCard } from './OrgCard'

describe('OrgCard', () => {
  it('renders the org name, role and a root badge for the platform root', () => {
    render(
      <OrgCard
        node={{ item: { id: 'root', name: 'FuzeFront', role: 'member', isRoot: true }, children: [] }}
        onOpen={vi.fn()}
      />
    )
    const card = screen.getByText(/fuzefront/i).closest('[data-org="root"]')
    expect(card).toHaveAttribute('data-role', 'member')
    expect(screen.getByText('root')).toBeInTheDocument()
  })

  it('calls onOpen with the org id', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <OrgCard node={{ item: { id: 'org_acme', name: 'Acme Co', role: 'viewer' }, children: [] }} onOpen={onOpen} />
    )
    await user.click(screen.getByRole('button', { name: /open/i }))
    expect(onOpen).toHaveBeenCalledWith('org_acme')
  })

  it('renders its sub-org tree', () => {
    render(
      <OrgCard
        node={{
          item: { id: 'org_northwind', name: 'Northwind', role: 'owner', isPortal: true },
          children: [{ item: { id: 'org_nw_sales', name: 'Sales', role: 'admin' }, children: [] }],
        }}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('portal')).toBeInTheDocument()
  })
})
