import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { RootCustomerInviteFlow } from './RootCustomerInviteFlow'
import { fakeClient, invitation, renderI18n } from '../testkit'

describe('RootCustomerInviteFlow', () => {
  it('lets the root owner invite an external email as a CUSTOMER (member type forced)', async () => {
    const create = vi.fn().mockResolvedValue(invitation({ memberType: 'customer', role: 'viewer' }))
    const onInvited = vi.fn()
    renderI18n(
      <RootCustomerInviteFlow rootOrganizationId="org_root" userRole="owner" client={fakeClient({ create })} onInvited={onInvited} />,
    )
    expect(document.querySelector('[data-panel="root-customer-invite"]')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Member type' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(document.querySelector('[data-input="customer-email"]') as HTMLElement, {
      target: { value: 'pat.rivera@gmail.com' },
    })
    const review = document.querySelector('[data-panel="customer-preview"]') as HTMLElement
    expect(review).toHaveTextContent('pat.rivera@gmail.com')
    expect(review.querySelector('[data-review="member-type"]')).toHaveTextContent('Customer')
    expect(review.querySelector('[data-review="role"]')).toHaveTextContent(/viewer/i)
    fireEvent.click(screen.getByRole('button', { name: 'Send customer invitation' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('org_root', {
        invitee: { kind: 'external', channel: 'email', email: 'pat.rivera@gmail.com' },
        role: 'viewer',
        memberType: 'customer',
      }),
    )
    expect(onInvited).toHaveBeenCalled()
  })

  it('offers only member | viewer and WhatsApp as a channel', () => {
    renderI18n(<RootCustomerInviteFlow rootOrganizationId="org_root" userRole="owner" client={fakeClient()} />)
    expect(screen.queryByRole('radio', { name: /^Admin / })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Member / })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Viewer / })).toBeChecked()
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument()
  })

  it('renders 403 forbidden IN PLACE for a non-owner — no form, no sign-in redirect', () => {
    renderI18n(<RootCustomerInviteFlow rootOrganizationId="org_root" userRole="admin" client={fakeClient()} />)
    expect(document.querySelector('[data-panel="root-customer-invite"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-state="forbidden"]')).toHaveAttribute('data-http', '403')
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
  })
})
