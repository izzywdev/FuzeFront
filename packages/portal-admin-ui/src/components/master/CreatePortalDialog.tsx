import { useState } from 'react'
import { Button, Input, Modal } from '@fuzefront/design-system'
import type { BillingMode } from '../../types'

export interface CreatePortalDialogProps {
  open: boolean
  submitting?: boolean
  /** Set when the last submit came back 409 SLUG_TAKEN — rendered inline on the slug field. */
  slugTakenError?: boolean
  onCancel: () => void
  onSubmit: (input: { name: string; slug: string; ownerEmail: string; billingMode: BillingMode }) => void
}

const PLAN_OPTIONS: Array<{ value: BillingMode; label: string; description: string }> = [
  { value: 'free', label: 'Free', description: 'No charge. FuzeFront-billed. Reseller billing off.' },
  {
    value: 'platform',
    label: 'Platform-billed',
    description: 'FuzeFront charges this portal (their own subscription). Standard tenant.',
  },
  {
    value: 'reseller',
    label: 'Reseller · Connect',
    description: "This portal bills its own customers via Stripe Connect. Unlocks the billing console (S4).",
  },
]

/** Create-portal form (frame 02-create-portal). Form state is kept LOCAL so a
 * 409 SLUG_TAKEN response never loses what the caller typed (see 04-master-states, d6). */
export function CreatePortalDialog({ open, submitting, slugTakenError, onCancel, onSubmit }: CreatePortalDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [billingMode, setBillingMode] = useState<BillingMode>('platform')

  return (
    <Modal open={open} onClose={onCancel} title="New portal">
      <div data-panel="create-portal">
        <form
          onSubmit={e => {
            e.preventDefault()
            onSubmit({ name: name.trim(), slug: slug.trim(), ownerEmail: ownerEmail.trim(), billingMode })
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          <Input
            label="Portal name"
            data-input="name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Acme, Inc."
            required
          />
          <div>
            <Input
              label="Slug"
              data-input="slug"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="acme"
              required
              error={slugTakenError ? 'That slug is already in use by another portal. Slugs are unique and permanent — pick another.' : undefined}
            />
            {slugTakenError && (
              <p
                data-error-code="SLUG_TAKEN"
                style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--error-color)' }}
              >
                That slug is already in use by another portal. Slugs are unique and permanent — pick another.
              </p>
            )}
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Lowercase, unique, immutable. Becomes the tenant's default subdomain until a custom domain is verified.
            </p>
          </div>
          <Input
            label="Owner email"
            type="email"
            data-input="owner-email"
            value={ownerEmail}
            onChange={e => setOwnerEmail(e.target.value)}
            placeholder="owner@company.com"
            required
          />
          <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <legend style={{ padding: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Plan &amp; billing mode
            </legend>
            {PLAN_OPTIONS.map(opt => (
              <label
                key={opt.value}
                data-plan-option={opt.value}
                data-selected={billingMode === opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  background: billingMode === opt.value ? 'var(--bg-quaternary)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="plan"
                  value={opt.value}
                  checked={billingMode === opt.value}
                  onChange={() => setBillingMode(opt.value)}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>{opt.label}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{opt.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Button type="button" variant="ghost" data-action="cancel" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" data-action="submit-create-portal" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create portal'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
