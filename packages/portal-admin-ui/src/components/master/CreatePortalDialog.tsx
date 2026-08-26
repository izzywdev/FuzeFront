import { useState } from 'react'
import { Button, Input, Modal } from '@fuzefront/design-system'
import type { AdminPortalAppCatalogMode, AdminPortalBillingMode, AdminPortalCreate } from '../../types'

export interface CreatePortalDialogProps {
  open: boolean
  submitting?: boolean
  /** Set when the last submit came back 409 CONFLICT on slug — rendered inline on the slug field. */
  slugTakenError?: boolean
  onCancel: () => void
  onSubmit: (input: AdminPortalCreate) => void
}

const BILLING_OPTIONS: Array<{ value: AdminPortalBillingMode; label: string; description: string }> = [
  { value: 'free', label: 'Free', description: 'No charge. FuzeFront-billed. Reseller billing off.' },
  {
    value: 'platform',
    label: 'Platform-billed',
    description: 'FuzeFront charges this portal (their own subscription). Standard tenant.',
  },
  {
    value: 'reseller',
    label: 'Reseller · Connect',
    description: 'This portal bills its own customers via Stripe Connect. Unlocks the billing console.',
  },
]

const CATALOG_OPTIONS: Array<{ value: AdminPortalAppCatalogMode; label: string; description: string }> = [
  { value: 'inherit', label: 'Inherit platform catalog', description: 'The portal shows the platform-root app catalog.' },
  { value: 'custom', label: 'Custom catalog', description: 'The portal curates its own app set.' },
]

/**
 * Create-portal form (frame 02-create-portal), migrated onto the REAL
 * `PortalCreate` body (`@fuzefront/security-client` 0.7.0): `name`, `slug`,
 * `ownerEmail`, the optional tenant attributes `customDomain` + `branding`,
 * and `billingMode` / `appCatalogMode`. Form state is kept LOCAL so a 409
 * `CONFLICT` (duplicate slug) response never loses what the caller typed.
 */
export function CreatePortalDialog({ open, submitting, slugTakenError, onCancel, onSubmit }: CreatePortalDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [tagline, setTagline] = useState('')
  const [billingMode, setBillingMode] = useState<AdminPortalBillingMode>('platform')
  const [appCatalogMode, setAppCatalogMode] = useState<AdminPortalAppCatalogMode>('inherit')

  return (
    <Modal open={open} onClose={onCancel} title="New portal">
      <div data-panel="create-portal">
        <form
          onSubmit={e => {
            e.preventDefault()
            const trimmedName = name.trim()
            const trimmedTagline = tagline.trim()
            onSubmit({
              name: trimmedName,
              slug: slug.trim(),
              ownerEmail: ownerEmail.trim(),
              customDomain: customDomain.trim() || undefined,
              branding: { name: trimmedName, ...(trimmedTagline ? { tagline: trimmedTagline } : {}) },
              billingMode,
              appCatalogMode,
            })
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
                data-error-code="CONFLICT"
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
          <Input
            label="Custom domain (optional)"
            data-input="custom-domain"
            value={customDomain}
            onChange={e => setCustomDomain(e.target.value)}
            placeholder="portal.acme.example"
          />
          <Input
            label="Tagline (optional branding)"
            data-input="branding-tagline"
            value={tagline}
            onChange={e => setTagline(e.target.value)}
            placeholder="Custom login copy shown to this portal's users"
          />
          <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <legend style={{ padding: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              App catalog
            </legend>
            {CATALOG_OPTIONS.map(opt => (
              <label
                key={opt.value}
                data-catalog-option={opt.value}
                data-selected={appCatalogMode === opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  background: appCatalogMode === opt.value ? 'var(--bg-quaternary)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="catalog-mode"
                  value={opt.value}
                  checked={appCatalogMode === opt.value}
                  onChange={() => setAppCatalogMode(opt.value)}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>{opt.label}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{opt.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <legend style={{ padding: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Plan &amp; billing mode
            </legend>
            {BILLING_OPTIONS.map(opt => (
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
