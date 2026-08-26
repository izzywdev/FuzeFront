import { useState } from 'react'
import { Alert, Button, Input, Modal } from '@fuzefront/design-system'
import type { InvitationRole } from '../../types'

export interface InviteUserDialogProps {
  open: boolean
  submitting?: boolean
  /** Set when the last submit came back 403 FORBIDDEN_PORTAL (frame 09-portal-states, i6). */
  forbidden?: boolean
  onCancel: () => void
  onSubmit: (input: { email: string; role: InvitationRole }) => void
}

/** Invite dialog (frame 06-users "Invite dialog" panel). */
export function InviteUserDialog({ open, submitting, forbidden, onCancel, onSubmit }: InviteUserDialogProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitationRole>('member')

  return (
    <Modal open={open} onClose={onCancel} title="Invite to this portal">
      <div data-panel="invite-user" data-state={forbidden ? 'forbidden' : 'default'}>
        {forbidden ? (
          <>
            <Alert tone="info" title="You don't administer this portal" data-error-code="FORBIDDEN_PORTAL" data-http="403">
              You're a Portal Admin, but not of the portal in this request. The console never accepts
              a portal id from the URL — it's resolved from your session. Nothing about another
              portal's users is shown here.
            </Alert>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
              <Button variant="ghost" data-action="cancel" onClick={onCancel}>
                Close
              </Button>
              <Button variant="primary" data-action="submit-invite" disabled style={{ marginInlineStart: 'var(--space-2)' }}>
                Send invite
              </Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={e => {
              e.preventDefault()
              onSubmit({ email: email.trim(), role })
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            <div>
              <Input
                label="Email"
                type="email"
                data-input="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                required
              />
              <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                They'll get an email to join this portal and set their own password.
              </p>
            </div>
            <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <legend style={{ padding: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Role
              </legend>
              {[
                { value: 'member' as InvitationRole, label: 'Member', description: "Uses the portal's apps. No admin access." },
                { value: 'admin' as InvitationRole, label: 'Portal admin', description: 'Manages users, catalog, and billing for this portal.' },
              ].map(opt => (
                <label
                  key={opt.value}
                  data-role-option={opt.value}
                  data-selected={role === opt.value}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: role === opt.value ? 'var(--bg-quaternary)' : 'transparent',
                  }}
                >
                  <input type="radio" name="role" value={opt.value} checked={role === opt.value} onChange={() => setRole(opt.value)} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>{opt.label}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{opt.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <Button type="button" variant="ghost" data-action="cancel" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" data-action="submit-invite" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send invite'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
