import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IdentityPage } from './IdentityPage'
import type { IdentityApiClient } from '../../types'

function makeClient(over: Partial<IdentityApiClient> = {}): IdentityApiClient {
  return {
    listMembers: vi.fn().mockResolvedValue({
      members: [
        { id: 'm1', role: 'admin', status: 'active', user: { id: 'u1', email: 'a@b.co', firstName: 'Ada', lastName: 'Byron' } },
      ],
      pagination: { page: 1, pageSize: 20, total: 1 },
    }),
    listRoles: vi.fn().mockResolvedValue({
      roles: [
        { key: 'owner', name: 'Owner', assignable: false, permissions: ['Organization:manage'] },
        { key: 'admin', name: 'Admin', assignable: true, permissions: ['Organization:manage'] },
        { key: 'member', name: 'Member', assignable: true, permissions: [] },
        { key: 'viewer', name: 'Viewer', assignable: true, permissions: ['Organization:read'] },
      ],
      resources: [
        { key: 'Organization', name: 'Organization', actions: [{ key: 'read', name: 'Read' }, { key: 'manage', name: 'Manage' }] },
      ],
    }),
    updateMemberRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    listInvitations: vi.fn().mockResolvedValue([
      { id: 'i1', email: 'p@e.co', role: 'member', status: 'pending' },
    ]),
    invite: vi.fn().mockResolvedValue(undefined),
    bulkInvite: vi.fn().mockResolvedValue({ created: 0, skipped: 0, errors: [] }),
    resendInvitation: vi.fn().mockResolvedValue(undefined),
    revokeInvitation: vi.fn().mockResolvedValue(undefined),
    listTokens: vi.fn().mockResolvedValue([]),
    listOrgTokens: vi.fn().mockResolvedValue([]),
    createToken: vi.fn(),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

describe('IdentityPage', () => {
  it('renders the tabs and Members by default', async () => {
    const client = makeClient()
    render(<IdentityPage organizationId="org-1" userRole="admin" apiClient={client} />)
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Permissions' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('a@b.co')).toBeInTheDocument())
  })

  it('switches to the Permissions tab and shows the role matrix', async () => {
    const client = makeClient()
    render(<IdentityPage organizationId="org-1" userRole="admin" apiClient={client} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Permissions' }))
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(client.listRoles).toHaveBeenCalledWith('org-1')
  })

  it('switches to the Pending tab', async () => {
    const client = makeClient()
    render(<IdentityPage organizationId="org-1" userRole="admin" apiClient={client} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Pending Invitations' }))
    await waitFor(() => expect(screen.getByText('p@e.co')).toBeInTheDocument())
  })

  it('switches to the API Tokens tab and shows the empty state', async () => {
    const client = makeClient()
    render(<IdentityPage organizationId="org-1" userRole="admin" userId="u1" apiClient={client} />)
    fireEvent.click(screen.getByRole('tab', { name: 'API Tokens' }))
    await waitFor(() => expect(screen.getByText('No tokens yet')).toBeInTheDocument())
  })

  it('applies dir="rtl" for the Hebrew locale', () => {
    const client = makeClient()
    const { container } = render(
      <IdentityPage organizationId="org-1" userRole="admin" apiClient={client} locale="he" />
    )
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy()
    // Hebrew tab label
    expect(screen.getByRole('tab', { name: 'חברים' })).toBeInTheDocument()
  })
})
