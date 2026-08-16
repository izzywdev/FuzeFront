import { useState } from 'react'
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

export interface CreateOrganizationDialogProps {
  open: boolean
  onClose: () => void
  /** Performs the create request. Reject with a NAME_TAKEN-shaped error for inline validation. */
  onCreate: (input: CreateOrganizationInput) => Promise<CreatedOrganization>
  onCreated?: (org: CreatedOrganization) => void
  /** Derives a slug candidate from the name (kept in the host app, which owns backend slug rules). */
  slugForName?: (name: string) => string
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
export function CreateOrganizationDialog({
  open,
  onClose,
  onCreate,
  onCreated,
  slugForName = defaultSlug,
}: CreateOrganizationDialogProps) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName('')
    setNameError(null)
    setFormError(null)
    setSubmitting(false)
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
        <Input
          label="Name"
          data-input="org-name"
          data-error-code={nameError ? 'NAME_TAKEN' : undefined}
          value={name}
          onChange={e => setName((e.target as HTMLInputElement).value)}
          error={nameError ?? ''}
          autoFocus
        />
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
