import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Modal, Input, Button, Alert } from '@fuzefront/design-system'

export interface CreateOrganizationInput {
  name: string
  slug: string
}

export interface CreatedOrganization {
  id: string
  name: string
}

/** Verdict from the host's real-time availability probe. */
export interface SlugAvailability {
  available: boolean
  reason?: 'taken' | 'invalid'
}

export interface CreateOrganizationDialogProps {
  open: boolean
  onClose: () => void
  /** Performs the create request. Reject with a NAME_TAKEN-shaped error for inline validation. */
  onCreate: (input: CreateOrganizationInput) => Promise<CreatedOrganization>
  onCreated?: (org: CreatedOrganization) => void
  /** Derives a slug candidate from the name (kept in the host app, which owns backend slug rules). */
  slugForName?: (name: string) => string
  /**
   * Optional real-time availability probe (host owns the API). When provided,
   * the dialog checks the derived slug as the user types and warns inline BEFORE
   * submit. The submit-time rejection from `onCreate` stays the safe gate, so
   * omitting this only loses the early warning, never the guard.
   */
  onCheckAvailability?: (slug: string) => Promise<SlugAvailability>
}

function defaultSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** True when the error looks like a NAME_TAKEN / slug-conflict rejection. */
function isNameTakenError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown })?.message === 'string'
        ? (err as { message: string }).message
        : String(err)
  return /name_taken|already exists|already taken|slug.*(taken|exists)/i.test(message)
}

/**
 * 05-states.html e6 — "Create organization" modal reachable from the
 * ContextSwitcher footer and the "My orgs & sub-orgs" list. A NAME_TAKEN
 * rejection renders INLINE on the field — never a toast that loses the form.
 */
type AvailabilityState =
  | { status: 'idle' | 'checking' | 'available' }
  | { status: 'taken' | 'invalid' }

export function CreateOrganizationDialog({
  open,
  onClose,
  onCreate,
  onCreated,
  slugForName = defaultSlug,
  onCheckAvailability,
}: CreateOrganizationDialogProps) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [availability, setAvailability] = useState<AvailabilityState>({ status: 'idle' })
  // Monotonic token so a slow probe that resolves after a newer keystroke is
  // discarded instead of clobbering the current verdict.
  const probeSeq = useRef(0)

  // Debounced as-you-type availability check. Only runs when the host wired a
  // probe; the submit-time guard covers the no-probe case.
  useEffect(() => {
    if (!onCheckAvailability) return
    const trimmed = name.trim()
    if (!trimmed) {
      setAvailability({ status: 'idle' })
      return
    }
    const seq = ++probeSeq.current
    setAvailability({ status: 'checking' })
    const timer = setTimeout(async () => {
      try {
        const { available, reason } = await onCheckAvailability(slugForName(trimmed))
        if (seq !== probeSeq.current) return // stale
        setAvailability(
          available
            ? { status: 'available' }
            : { status: reason === 'invalid' ? 'invalid' : 'taken' }
        )
      } catch {
        if (seq !== probeSeq.current) return
        setAvailability({ status: 'idle' }) // probe failure never blocks; submit re-checks
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [name, onCheckAvailability, slugForName])

  function reset() {
    setName('')
    setNameError(null)
    setFormError(null)
    setSubmitting(false)
    probeSeq.current++
    setAvailability({ status: 'idle' })
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name is required')
      return
    }
    setNameError(null)
    setFormError(null)
    setSubmitting(true)
    try {
      const org = await onCreate({ name: trimmed, slug: slugForName(trimmed) })
      onCreated?.(org)
      reset()
      onClose()
    } catch (err) {
      if (isNameTakenError(err)) {
        setNameError('That name is already taken')
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to create organization')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create organization" size="md">
      <form
        onSubmit={handleSubmit}
        data-state={nameError ? 'create-error' : undefined}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        {(() => {
          const liveError =
            availability.status === 'taken'
              ? 'That name is already taken'
              : availability.status === 'invalid'
                ? 'That name can’t be turned into a URL — try adding letters or numbers'
                : null
          const shownError = nameError ?? liveError
          return (
            <div>
              <Input
                label="Name"
                data-input="org-name"
                data-error-code={shownError ? 'NAME_TAKEN' : undefined}
                data-availability={availability.status}
                value={name}
                onChange={e => setName((e.target as HTMLInputElement).value)}
                error={shownError ?? ''}
                autoFocus
              />
              {/* Positive / in-flight states use a quiet helper line; the taken/
                  invalid states ride the Input's own error affordance above. */}
              {!shownError && availability.status === 'checking' && (
                <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  Checking availability…
                </p>
              )}
              {!shownError && availability.status === 'available' && (
                <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-success, var(--text-secondary))' }}>
                  ✓ Available
                </p>
              )}
            </div>
          )
        })()}
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create organization'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
