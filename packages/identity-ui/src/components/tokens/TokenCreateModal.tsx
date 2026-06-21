import React, { useState } from 'react'
import { Modal, Input, Select, Button, Toast } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { ScopeSelector } from './ScopeSelector'
import type { CreatedApiToken, TokenOwnerType } from '../../types'
import type { CreateTokenInput } from '../../api/tokens'

export interface TokenCreateModalProps {
  open: boolean
  onClose: () => void
  /** Owner the new token belongs to — drives owner_type/owner_id in the request. */
  ownerType: TokenOwnerType
  ownerId: string
  /** Optional org context for PAT scope validation. */
  orgId?: string
  /** Scopes the owner may grant; passed through to ScopeSelector. */
  availableScopes?: string[]
  /** Performs the create request and returns the one-time token. */
  onCreate: (input: CreateTokenInput) => Promise<CreatedApiToken>
  /** Called after a successful create (e.g. to refresh the list). */
  onCreated?: (token: CreatedApiToken) => void
}

type Phase = 'form' | 'submitting' | 'revealed'

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'noExpiry' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '365 days' },
] as const

function expiryToIso(value: string): string | null {
  if (value === 'never') return null
  const days = Number(value)
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Create-token modal with a one-time secret reveal. On success the raw token is
 * shown exactly once with a copy button and a prominent "won't be shown again"
 * warning; dismissing never re-shows it.
 */
export function TokenCreateModal({
  open,
  onClose,
  ownerType,
  ownerId,
  orgId,
  availableScopes,
  onCreate,
  onCreated,
}: TokenCreateModalProps) {
  const { messages } = useIdentityI18n()
  const t = messages.tokens
  const [phase, setPhase] = useState<Phase>('form')
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [expiry, setExpiry] = useState<string>('never')
  const [nameError, setNameError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<CreatedApiToken | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setPhase('form')
    setName('')
    setScopes([])
    setExpiry('never')
    setNameError(null)
    setCreateError(null)
    setRevealed(null)
    setCopied(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setNameError('Name is required')
      return
    }
    setCreateError(null)
    setPhase('submitting')
    try {
      const input: CreateTokenInput = {
        name: name.trim(),
        owner_type: ownerType,
        owner_id: ownerId,
        scopes,
        expires_at: expiryToIso(expiry),
        ...(orgId ? { org_id: orgId } : {}),
      }
      const token = await onCreate(input)
      setRevealed(token)
      setPhase('revealed')
      onCreated?.(token)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t.createError)
      setPhase('form')
    }
  }

  async function handleCopy() {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed.token)
      setCopied(true)
    } catch {
      /* clipboard may be unavailable; leave copied false */
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={handleClose} title={phase === 'revealed' ? t.revealTitle : t.create} size="md">
      {phase === 'revealed' && revealed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Toast level="warning" message={t.revealWarning} />
          <input
            readOnly
            value={revealed.token}
            aria-label={t.revealTitle}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-3)',
              background: 'var(--bg-quaternary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={handleCopy} aria-live="polite">
              {copied ? t.copied : t.copy}
            </Button>
            <Button variant="primary" onClick={handleClose}>
              {t.done}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {createError && <Toast level="error" message={createError} />}
          <Input
            label={t.nameLabel}
            placeholder={t.namePlaceholder}
            value={name}
            error={nameError ?? undefined}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(null)
            }}
          />
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t.scopesLabel}
            </label>
            <ScopeSelector value={scopes} onChange={setScopes} availableScopes={availableScopes} />
          </div>
          <Select
            label={t.expiryLabel}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            options={EXPIRY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.value === 'never' ? t.noExpiry : o.label,
            }))}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleClose}>
              {messages.common.cancel}
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={phase === 'submitting'}>
              {t.create}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
