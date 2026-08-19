import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PendingInvitesList } from './PendingInvitesList'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { Invitation } from '../../types'

const invites: Invitation[] = [
  { id: 'i1', email: 'a@b.co', role: 'member', status: 'pending', created_at: '2025-06-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' },
  { id: 'i2', email: 'c@d.ef', role: 'admin', status: 'pending', created_at: '2025-06-02T00:00:00Z', expires_at: '2000-01-01T00:00:00Z' },
]

function renderList(props: Partial<React.ComponentProps<typeof PendingInvitesList>> = {}) {
  const onResend = vi.fn().mockResolvedValue(undefined)
  const onRevoke = vi.fn().mockResolvedValue(undefined)
  render(
    <IdentityI18nProvider>
      <PendingInvitesList invitations={invites} userRole="admin" onResend={onResend} onRevoke={onRevoke} {...props} />
    </IdentityI18nProvider>
  )
  return { onResend, onRevoke }
}

describe('PendingInvitesList', () => {
  it('renders a row per invitation', () => {
    renderList()
    expect(screen.getByText('a@b.co')).toBeInTheDocument()
    expect(screen.getByText('c@d.ef')).toBeInTheDocument()
  })

  it('shows the empty state when there are none', () => {
    renderList({ invitations: [] })
    expect(screen.getByText('No pending invitations')).toBeInTheDocument()
  })

  it('shows an expired status pill for past-expiry invitations', () => {
    renderList()
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('calls onResend for a row', async () => {
    const { onResend } = renderList()
    fireEvent.click(screen.getAllByRole('button', { name: 'Resend' })[0])
    await waitFor(() => expect(onResend).toHaveBeenCalledWith('i1'))
  })

  it('optimistically hides a row on revoke', async () => {
    const { onRevoke } = renderList()
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('i1'))
    await waitFor(() => expect(screen.queryByText('a@b.co')).not.toBeInTheDocument())
  })

  it('hides actions for viewers', () => {
    renderList({ userRole: 'viewer' })
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
  })
})
