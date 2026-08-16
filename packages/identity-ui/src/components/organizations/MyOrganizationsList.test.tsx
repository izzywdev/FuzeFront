import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MyOrganizationsList } from './MyOrganizationsList'
import type { OrgContextItem } from '../../types'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

describe('MyOrganizationsList', () => {
  it('renders the loading skeleton', () => {
    render(<MyOrganizationsList organizations={[]} loading onOpenOrg={vi.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders an error state with retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<MyOrganizationsList organizations={[]} error="Network error" onRetry={onRetry} onOpenOrg={vi.fn()} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('AC3: a user who belongs only to root sees just root with MEMBER, never an empty/broken list', () => {
    const organizations: OrgContextItem[] = [
      { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
    ]
    render(<MyOrganizationsList organizations={organizations} rootOrgId={ROOT_ID} onOpenOrg={vi.fn()} onCreateOrg={vi.fn()} />)
    const list = screen.getByText(/fuzefront/i).closest('[data-list="my-orgs"]')
    expect(list).toBeInTheDocument()
    // root row itself
    expect(screen.getByText(/fuzefront/i).closest('[data-org]')).toHaveAttribute('data-role', 'member')
    // "empty beyond root" invitation still shown, but root is never hidden
    expect(screen.getByText(/just you and the platform/i)).toBeInTheDocument()
  })

  it('renders every direct-membership org and its sub-org tree beyond root', () => {
    const organizations: OrgContextItem[] = [
      { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
      { id: 'org_northwind', name: 'Northwind', role: 'owner', isPortal: true, parentId: ROOT_ID },
      { id: 'org_nw_sales', name: 'Sales', role: 'admin', parentId: 'org_northwind' },
      { id: 'org_acme', name: 'Acme Co', role: 'viewer', parentId: null },
    ]
    render(<MyOrganizationsList organizations={organizations} rootOrgId={ROOT_ID} onOpenOrg={vi.fn()} />)
    expect(screen.getByText('Northwind')).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Acme Co')).toBeInTheDocument()
    expect(screen.queryByText(/just you and the platform/i)).not.toBeInTheDocument()
  })

  it('calls onOpenOrg when Open is clicked on a card', async () => {
    const user = userEvent.setup()
    const onOpenOrg = vi.fn()
    const organizations: OrgContextItem[] = [
      { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
      { id: 'org_acme', name: 'Acme Co', role: 'viewer', parentId: null },
    ]
    render(<MyOrganizationsList organizations={organizations} rootOrgId={ROOT_ID} onOpenOrg={onOpenOrg} />)
    const acmeCard = screen.getByText('Acme Co').closest('[data-org="org_acme"]') as HTMLElement
    await user.click(within(acmeCard).getByRole('button', { name: /open/i }))
    expect(onOpenOrg).toHaveBeenCalledWith('org_acme')
  })
})
