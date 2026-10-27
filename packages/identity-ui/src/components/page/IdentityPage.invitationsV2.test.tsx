import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IdentityPage } from './IdentityPage'
import type { IdentityApiClient } from '../../types'
import { fakeClient, invitation } from '../invitations/testkit'

function makeClient(): IdentityApiClient {
  return {
    listMembers: vi.fn().mockResolvedValue({
      members: [{ id: 'm1', role: 'admin', status: 'active', user: { id: 'u1', email: 'a@b.co' } }],
      pagination: { page: 1, pageSize: 20, total: 1 },
    }),
    listRoles: vi.fn().mockResolvedValue({ roles: [], resources: [] }),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    listInvitations: vi.fn().mockResolvedValue([{ id: 'i1', email: 'v1@e.co', role: 'member', status: 'pending' }]),
    invite: vi.fn().mockResolvedValue(undefined),
    bulkInvite: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    listTokens: vi.fn().mockResolvedValue([]),
    listOrgTokens: vi.fn().mockResolvedValue([]),
    createToken: vi.fn(),
    revokeToken: vi.fn(),
  }
}

// Feature flag `fuzefront.identity.invite-v2`: the HOST reads it and passes
// `invitationsV2`. Both states are exercised (skill: feature-flags — test BOTH).
describe('IdentityPage — flag fuzefront.identity.invite-v2', () => {
  it('OFF (default): the v1 invite modal (Single/Bulk tabs) and v1 pending list are unchanged', async () => {
    const client = makeClient()
    render(<IdentityPage organizationId="org-1" userRole="admin" apiClient={client} />)
    await waitFor(() => expect(client.listInvitations).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    expect(await screen.findByRole('tab', { name: 'Single' })).toBeInTheDocument()
    expect(document.querySelector('[data-panel="invite-modal"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-field="member-type"]')).not.toBeInTheDocument()
  })

  it('ON: Invite opens the v2 dialog (kind · channel · role · member type) and v1 invitations are not fetched', async () => {
    const client = makeClient()
    const invitationsClient = fakeClient()
    render(
      <IdentityPage
        organizationId="org-1"
        organizationName="Northwind"
        userRole="admin"
        apiClient={client}
        invitationsClient={invitationsClient}
        invitationsV2
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /invite people/i }))
    expect(await screen.findByText('Invite to Northwind')).toBeInTheDocument()
    expect(document.querySelector('[data-field="invitee-kind"]')).toBeInTheDocument()
    expect(document.querySelector('[data-field="channel"]')).toBeInTheDocument()
    expect(document.querySelector('[data-field="role"]')).toBeInTheDocument()
    expect(document.querySelector('[data-field="member-type"]')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Single' })).not.toBeInTheDocument()
    expect(client.listInvitations).not.toHaveBeenCalled()
  })

  it('ON: the Pending tab renders the cursor-paginated v2 panel from the contract client', async () => {
    const client = makeClient()
    const list = vi.fn().mockResolvedValue({
      items: [invitation({ memberType: 'customer' })],
      page: { nextCursor: null, hasMore: false },
    })
    render(
      <IdentityPage
        organizationId="org-1"
        userRole="owner"
        apiClient={client}
        invitationsClient={fakeClient({ list })}
        invitationsV2
      />,
    )
    fireEvent.click(await screen.findByRole('tab', { name: 'Pending Invitations' }))
    expect(await screen.findByText('jordan@acme.com')).toBeInTheDocument()
    expect(document.querySelector('[data-member-type="customer"]')).toBeInTheDocument()
    expect(screen.queryByText('v1@e.co')).not.toBeInTheDocument()
  })

  it('ON: a non-privileged caller gets no invite button (viewer)', async () => {
    render(
      <IdentityPage
        organizationId="org-1"
        userRole="viewer"
        apiClient={makeClient()}
        invitationsClient={fakeClient()}
        invitationsV2
      />,
    )
    await screen.findByRole('tab', { name: 'Members' })
    expect(screen.queryByRole('button', { name: /invite people/i })).not.toBeInTheDocument()
  })
})
