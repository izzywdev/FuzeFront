import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { InviteForm } from './InviteForm'
import { InviteModalV2 } from './InviteModalV2'
import { http, invitation, renderI18n } from '../testkit'

function setup(over: Partial<React.ComponentProps<typeof InviteForm>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(invitation())
  const onSent = vi.fn()
  renderI18n(<InviteForm onSubmit={onSubmit} onSent={onSent} {...over} />)
  return { onSubmit, onSent }
}

const send = () => screen.getByRole('button', { name: /send invitation/i })

describe('InviteForm (org invite v2)', () => {
  it('blocks Send until a valid address is present, then posts a discriminated external/email invitee', async () => {
    const { onSubmit, onSent } = setup()
    expect(send()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'nope' } })
    expect(send()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'jordan@acme.com' } })
    fireEvent.click(screen.getByRole('radio', { name: /^Admin / }))
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }))
    expect(send()).toBeEnabled()
    fireEvent.click(send())
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        invitee: { kind: 'external', channel: 'email', email: 'jordan@acme.com' },
        role: 'admin',
        memberType: 'customer',
      }),
    )
    expect(onSent).toHaveBeenCalled()
  })

  it('switches the address field with the channel and posts a whatsapp E.164 invitee', async () => {
    const { onSubmit } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))
    expect(document.querySelector('[data-channel-field="email"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-channel-field="whatsapp"]')).toBeInTheDocument()
    expect(send()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/whatsapp number/i), { target: { value: '5550104477' } })
    expect(send()).toBeEnabled()
    fireEvent.click(send())
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ invitee: { kind: 'external', channel: 'whatsapp', phone: '+15550104477' } }),
      ),
    )
  })

  it('keeps Send blocked for an invalid E.164 number and flags it after blur', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))
    const phone = screen.getByLabelText(/whatsapp number/i)
    fireEvent.change(phone, { target: { value: '55' } })
    fireEvent.blur(phone)
    expect(send()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveAttribute('data-error-code', 'INVALID_PHONE')
  })

  it('never offers owner as a role and reviews address + role + member type live', () => {
    setup()
    expect(screen.queryByRole('radio', { name: /^Owner / })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'jordan@acme.com' } })
    const review = document.querySelector('[data-panel="invite-preview"]') as HTMLElement
    expect(review).toHaveTextContent('jordan@acme.com')
    expect(review.querySelector('[data-review="member-type"]')).toHaveTextContent('Employee')
    fireEvent.click(screen.getByRole('radio', { name: /^Viewer / }))
    expect(review.querySelector('[data-review="role"]')).toHaveTextContent(/viewer/i)
  })

  it('disables the existing-account kind when the host cannot search accounts', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Existing account-holder' })).toBeDisabled()
  })

  it('sends an AccountInvitee reference for an existing account-holder', async () => {
    const searchAccounts = vi.fn().mockResolvedValue([{ userId: 'usr_01h', name: 'Sam Lee', email: 'sam@globex.io' }])
    const { onSubmit } = setup({ searchAccounts })
    fireEvent.click(screen.getByRole('button', { name: 'Existing account-holder' }))
    fireEvent.change(screen.getByLabelText(/find an account/i), { target: { value: 'sam' } })
    fireEvent.click(await screen.findByRole('button', { name: /sam lee/i }))
    fireEvent.click(send())
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ invitee: { kind: 'account', userId: 'usr_01h' } }),
      ),
    )
  })

  it('renders 403 forbidden IN PLACE (no redirect) and a 409 duplicate', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(http(403)).mockRejectedValueOnce(http(409))
    setup({ onSubmit })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'jordan@acme.com' } })
    fireEvent.click(send())
    const forbidden = await screen.findByText(/don't have permission to invite/i)
    expect(forbidden.closest('[data-state="forbidden"]')).toHaveAttribute('data-http', '403')
    fireEvent.click(send())
    await waitFor(() => expect(document.querySelector('[data-state="duplicate"]')).toBeInTheDocument())
  })

  it('keeps the draft and refreshes the list when delivery failed', async () => {
    const onDraftSaved = vi.fn()
    const onSubmit = vi.fn().mockRejectedValue(http(502, { code: 'DELIVERY_FAILED' }))
    setup({ onSubmit, onDraftSaved })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'jordan@acme.com' } })
    fireEvent.click(send())
    await waitFor(() => expect(document.querySelector('[data-error-code="DELIVERY_FAILED"]')).toBeInTheDocument())
    expect(onDraftSaved).toHaveBeenCalled()
  })

  it('fixes the member type to Customer when locked (inert, aria-disabled) and posts memberType customer', async () => {
    const { onSubmit } = setup({ showKind: false, lockedMemberType: 'customer', roles: ['member', 'viewer'], defaultRole: 'viewer' })
    const group = screen.getByRole('group', { name: 'Member type' })
    expect(group).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('radio', { name: /^Admin / })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'pat@gmail.com' } })
    fireEvent.click(send())
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ memberType: 'customer', role: 'viewer' })),
    )
  })

  it('localizes to Hebrew without physical CSS properties (RTL-safe)', () => {
    const { container } = renderI18n(<InviteForm onSubmit={vi.fn()} />, 'he')
    expect(screen.getByText('את מי מזמינים?')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/)
  })
})

describe('InviteModalV2', () => {
  it('is an accessible dialog titled for the org and closes on Cancel', () => {
    const onClose = vi.fn()
    renderI18n(<InviteModalV2 open onClose={onClose} orgName="Northwind" onSubmit={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Invite to Northwind')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    renderI18n(<InviteModalV2 open={false} onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
