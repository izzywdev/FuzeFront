import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InviteModal } from './InviteModal'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

function setup(overrides: Partial<React.ComponentProps<typeof InviteModal>> = {}) {
  const onInvite = vi.fn().mockResolvedValue(undefined)
  const onBulkInvite = vi.fn().mockResolvedValue({ created: 2, skipped: 0, errors: [] })
  const onClose = vi.fn()
  render(
    <IdentityI18nProvider>
      <InviteModal open onClose={onClose} onInvite={onInvite} onBulkInvite={onBulkInvite} {...overrides} />
    </IdentityI18nProvider>
  )
  return { onInvite, onBulkInvite, onClose }
}

describe('InviteModal', () => {
  it('renders both tabs and the dialog role', () => {
    setup()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Single' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Bulk / CSV' })).toBeInTheDocument()
  })

  it('submits a single invite with email + role', async () => {
    const { onInvite } = setup()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@ex.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('new@ex.com', 'member'))
  })

  it('shows a validation error for an invalid single email', async () => {
    const { onInvite } = setup()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(screen.getByText(/valid email/i)).toBeInTheDocument())
    expect(onInvite).not.toHaveBeenCalled()
  })

  it('parses textarea emails on the bulk tab and submits them', async () => {
    const { onBulkInvite } = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Bulk / CSV' }))
    fireEvent.change(screen.getByLabelText('Email addresses'), {
      target: { value: 'a@b.co\nc@d.ef' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send invites' }))
    await waitFor(() =>
      expect(onBulkInvite).toHaveBeenCalledWith([
        { email: 'a@b.co', role: 'member' },
        { email: 'c@d.ef', role: 'member' },
      ])
    )
  })

  it('disables bulk submit when there are no valid emails', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Bulk / CSV' }))
    expect(screen.getByRole('button', { name: 'Send invites' })).toBeDisabled()
  })
})
