import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PendingInvitationsPanel, type PendingInvitationsPanelProps } from './PendingInvitationsPanel'
import { http, invitation, renderI18n } from '../testkit'

function setup(over: Partial<PendingInvitationsPanelProps> = {}) {
  const props: PendingInvitationsPanelProps = {
    invitations: [
      invitation(),
      invitation({
        id: 'inv_03zt',
        invitee: { kind: 'external', channel: 'whatsapp', phone: '+15550104477' },
        channel: 'whatsapp',
        role: 'viewer',
        memberType: 'customer',
      }),
    ],
    canManage: true,
    currentUserId: 'usr_me',
    onResend: vi.fn().mockResolvedValue(undefined),
    onRevoke: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  renderI18n(<PendingInvitationsPanel {...props} />)
  return props
}

const panel = () => document.querySelector('[data-panel="pending-invitations"]') as HTMLElement

describe('PendingInvitationsPanel', () => {
  it('renders rows keyed to the invitation record: address, channel, role + member-type tags, status', () => {
    setup()
    expect(panel()).toHaveAttribute('data-state', 'populated')
    expect(document.querySelector('[data-count="pending"]')).toHaveTextContent('2 pending')
    const row = document.querySelector('[data-invitation="inv_03zt"]') as HTMLElement
    expect(row).toHaveAttribute('data-status', 'pending')
    expect(within(row).getByText('+15550104477')).toBeInTheDocument()
    expect(row.querySelector('[data-channel="whatsapp"]')).toBeInTheDocument()
    expect(row.querySelector('[data-member-type="customer"]')).toHaveTextContent('Customer')
    expect(within(row).getByText('Sent')).toBeInTheDocument()
    expect(row).toHaveTextContent('invited by you')
  })

  it('shows aria-busy skeleton rows while loading', () => {
    setup({ loading: true, invitations: [] })
    expect(panel()).toHaveAttribute('aria-busy', 'true')
    expect(panel()).toHaveAttribute('data-state', 'loading')
    expect(screen.getByRole('status', { name: 'Loading invitations' })).toBeInTheDocument()
  })

  it('treats empty as a real state with an invite CTA', () => {
    const onInvite = vi.fn()
    setup({ invitations: [], onInvite })
    expect(panel()).toHaveAttribute('data-state', 'empty')
    expect(screen.getByText('No invitations pending')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /invite people/i }))
    expect(onInvite).toHaveBeenCalled()
  })

  it('shows error with retry', () => {
    const onRetry = vi.fn()
    setup({ invitations: [], error: 'boom', onRetry })
    expect(panel()).toHaveAttribute('data-state', 'error')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('renders a 403 in place with zero data and no sign-in prompt', () => {
    setup({ invitations: [], forbidden: true })
    expect(panel()).toHaveAttribute('data-state', 'forbidden')
    expect(document.querySelector('[data-error-code="FORBIDDEN"]')).toHaveAttribute('data-http', '403')
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
  })

  it('offers Load more only while the cursor envelope says hasMore', () => {
    const onLoadMore = vi.fn()
    setup({ hasMore: true, onLoadMore })
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('hides Load more at the end of the cursor', () => {
    setup({ hasMore: false })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('confirms before revoking, then revokes by id', async () => {
    const props = setup()
    fireEvent.click(document.querySelector('[data-action="revoke"][data-for="inv_01hy"]') as HTMLElement)
    expect(await screen.findByText('Revoke this invitation?')).toBeInTheDocument()
    expect(props.onRevoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }))
    await waitFor(() => expect(props.onRevoke).toHaveBeenCalledWith('inv_01hy'))
  })

  it('disables Resend during the rate-limit cooldown after a successful resend', async () => {
    const props = setup()
    const resend = () => document.querySelector('[data-action="resend"][data-for="inv_01hy"]') as HTMLButtonElement
    fireEvent.click(resend())
    await waitFor(() => expect(props.onResend).toHaveBeenCalledWith('inv_01hy'))
    await waitFor(() => expect(resend()).toBeDisabled())
    expect(resend()).toHaveAttribute('aria-disabled', 'true')
    expect(resend().title).toMatch(/Resend available in \d\d:\d\d/)
    expect(document.querySelector('[data-state="resend-cooldown"]')).toBeInTheDocument()
  })

  it('starts the cooldown when the server rate-limits a resend (429)', async () => {
    const onResend = vi.fn().mockRejectedValue(http(429))
    setup({ onResend })
    const btn = () => document.querySelector('[data-action="resend"][data-for="inv_01hy"]') as HTMLButtonElement
    fireEvent.click(btn())
    await waitFor(() => expect(btn()).toBeDisabled())
  })

  it('hides resend/revoke for callers who cannot manage', () => {
    setup({ canManage: false })
    expect(document.querySelector('[data-action="resend"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-action="revoke"]')).not.toBeInTheDocument()
  })

  it('localizes to Hebrew', () => {
    renderI18n(<PendingInvitationsPanel invitations={[]} canManage onResend={vi.fn()} onRevoke={vi.fn()} />, 'he')
    expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument()
  })
})
