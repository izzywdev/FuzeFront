import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { OrgInviteFlow } from './OrgInviteFlow'
import { fakeClient, http, invitation, renderI18n } from '../testkit'

describe('OrgInviteFlow', () => {
  it('follows page.nextCursor until hasMore is false (cursor envelope, with limit)', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        items: [invitation({ id: 'inv_a' })],
        page: { nextCursor: 'cur_2', hasMore: true, total: 2 },
      })
      .mockResolvedValueOnce({
        items: [invitation({ id: 'inv_b', invitee: { kind: 'external', channel: 'email', email: 'sam@globex.io' } })],
        page: { nextCursor: null, hasMore: false, total: 2 },
      })
    const client = fakeClient({ list })
    renderI18n(
      <OrgInviteFlow organizationId="org_1" userRole="admin" client={client} inviteOpen={false} onInviteOpenChange={() => {}} pageSize={1} />,
    )
    await screen.findByText('jordan@acme.com')
    expect(list).toHaveBeenNthCalledWith(1, 'org_1', { limit: 1, status: 'pending' })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('sam@globex.io')
    expect(list).toHaveBeenNthCalledWith(2, 'org_1', { limit: 1, status: 'pending', cursor: 'cur_2' })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(screen.getByText('jordan@acme.com')).toBeInTheDocument()
  })

  it('renders a 403 list in place as forbidden (not an error, not a redirect)', async () => {
    const client = fakeClient({ list: vi.fn().mockRejectedValue(http(403)) })
    renderI18n(
      <OrgInviteFlow organizationId="org_1" userRole="member" client={client} inviteOpen={false} onInviteOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-panel="pending-invitations"]')).toHaveAttribute('data-state', 'forbidden'),
    )
  })

  it('creates an invitation through the dialog, closes it and reloads the list', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } })
    const create = vi.fn().mockResolvedValue(invitation())
    const client = fakeClient({ list, create })
    const onInviteOpenChange = vi.fn()
    renderI18n(
      <OrgInviteFlow
        organizationId="org_1"
        orgName="Northwind"
        userRole="owner"
        client={client}
        inviteOpen
        onInviteOpenChange={onInviteOpenChange}
      />,
    )
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'jordan@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send invitation/i }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('org_1', {
        invitee: { kind: 'external', channel: 'email', email: 'jordan@acme.com' },
        role: 'member',
        memberType: 'employee',
      }),
    )
    await waitFor(() => expect(onInviteOpenChange).toHaveBeenCalledWith(false))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('revokes via the client and drops the row', async () => {
    const list = vi.fn().mockResolvedValue({ items: [invitation()], page: { nextCursor: null, hasMore: false } })
    const revoke = vi.fn().mockResolvedValue(undefined)
    renderI18n(
      <OrgInviteFlow organizationId="org_1" userRole="admin" client={fakeClient({ list, revoke })} inviteOpen={false} onInviteOpenChange={() => {}} />,
    )
    await screen.findByText('jordan@acme.com')
    fireEvent.click(document.querySelector('[data-action="revoke"]') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke invitation' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('org_1', 'inv_01hy'))
    await waitFor(() => expect(screen.queryByText('jordan@acme.com')).not.toBeInTheDocument())
  })

  it('does not fetch the list when the pending panel is not shown', async () => {
    const list = vi.fn()
    renderI18n(
      <OrgInviteFlow organizationId="org_1" userRole="admin" client={fakeClient({ list })} inviteOpen={false} onInviteOpenChange={() => {}} showPending={false} />,
    )
    expect(list).not.toHaveBeenCalled()
    expect(document.querySelector('[data-panel="pending-invitations"]')).not.toBeInTheDocument()
  })
})
