import { useMemo, useState } from 'react'
import { Modal, Input, Select, Textarea, Button, Toast, FileDropZone, Badge } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { isValidEmail, parseEmailText, parseCsv, type ParsedEmail } from './parseEmails'
import type { OrgRole } from '../../types'

export interface InviteModalProps {
  open: boolean
  onClose: () => void
  /** Sends a single invite. */
  onInvite: (email: string, role: OrgRole) => Promise<void>
  /** Sends a batch; resolves with a summary. */
  onBulkInvite: (invitations: { email: string; role: OrgRole }[]) => Promise<{ created: number; skipped: number; errors: string[] }>
  /** Called after any successful send so the host can refresh. */
  onSuccess?: (count: number) => void
  defaultRole?: OrgRole
}

type Tab = 'single' | 'bulk'
const INVITE_ROLES: OrgRole[] = ['admin', 'member', 'viewer']

/**
 * Two-tab invite dialog: Single (one email + role) and Bulk/CSV (textarea or
 * CSV drop). Built on the design-system Modal / Input / Select / Textarea /
 * FileDropZone. Result summary is announced via aria-live.
 */
export function InviteModal({ open, onClose, onInvite, onBulkInvite, onSuccess, defaultRole = 'member' }: InviteModalProps) {
  const { messages, t } = useIdentityI18n()
  const inv = messages.invitations
  const [tab, setTab] = useState<Tab>('single')
  const [role, setRole] = useState<OrgRole>(defaultRole)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [bulkText, setBulkText] = useState('')
  const [csvParsed, setCsvParsed] = useState<ParsedEmail[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const parsed = useMemo<ParsedEmail[]>(() => {
    if (csvParsed) return csvParsed
    return parseEmailText(bulkText)
  }, [csvParsed, bulkText])
  const validEmails = parsed.filter((p) => p.valid)

  const roleOptions = INVITE_ROLES.map((r) => ({ value: r, label: messages.roles[r] }))

  function handleClose() {
    if (submitting) return
    setTab('single')
    setEmail('')
    setEmailError(null)
    setBulkText('')
    setCsvParsed(null)
    setError(null)
    setSummary(null)
    onClose()
  }

  async function handleSingle() {
    if (!isValidEmail(email)) {
      setEmailError(inv.invalidEmail)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onInvite(email.trim(), role)
      setSummary(t(inv.invitedCount, { count: 1 }))
      onSuccess?.(1)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleBulk() {
    if (validEmails.length === 0) {
      setError(inv.noValidEmails)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const result = await onBulkInvite(validEmails.map((p) => ({ email: p.email.trim(), role })))
      setSummary(
        `${t(inv.invitedCount, { count: result.created })}` +
          (result.skipped ? ` · ${result.skipped} ${inv.skipped}` : '') +
          (result.errors.length ? ` · ${result.errors.length} ${inv.errors}` : '')
      )
      onSuccess?.(result.created)
      if (result.errors.length === 0) handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const file = Array.from(files)[0]
    if (!file) return
    const text = await file.text()
    setCsvParsed(parseCsv(text))
  }

  if (!open) return null

  const tabButton = (key: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      style={{
        appearance: 'none',
        background: 'none',
        border: 'none',
        borderBottom: tab === key ? '2px solid var(--accent-color)' : '2px solid transparent',
        padding: 'var(--space-2) var(--space-3)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-medium)',
        color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <Modal open={open} onClose={handleClose} title={inv.inviteTitle} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div role="tablist" style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border-color)' }}>
          {tabButton('single', inv.tabSingle)}
          {tabButton('bulk', inv.tabBulk)}
        </div>

        {error && <Toast level="error" message={error} />}
        {summary && <div role="status" aria-live="polite" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{summary}</div>}

        {tab === 'single' ? (
          <>
            <Input
              label={inv.email}
              type="email"
              placeholder={inv.emailPlaceholder}
              value={email}
              error={emailError ?? undefined}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(null)
              }}
            />
            <Select label={inv.role} value={role} options={roleOptions} onChange={(e) => setRole(e.target.value as OrgRole)} />
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={handleClose}>{messages.common.cancel}</Button>
              <Button variant="primary" onClick={handleSingle} disabled={submitting}>{inv.send}</Button>
            </div>
          </>
        ) : (
          <>
            <Textarea
              label={inv.bulkTextareaLabel}
              placeholder={inv.bulkTextareaPlaceholder}
              value={bulkText}
              rows={4}
              onChange={(e) => {
                setBulkText(e.target.value)
                setCsvParsed(null)
              }}
            />
            <FileDropZone accept=".csv" label={inv.csvHint} onFiles={handleFiles} />
            <Select label={inv.role} value={role} options={roleOptions} onChange={(e) => setRole(e.target.value as OrgRole)} />
            {parsed.length > 0 && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
                  {inv.previewTitle} ({validEmails.length})
                </div>
                <div
                  style={{
                    maxHeight: 140,
                    overflowY: 'auto',
                    background: 'var(--bg-quaternary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--space-1)',
                  }}
                >
                  {parsed.map((p) => (
                    <Badge key={p.email} tone={p.valid ? 'neutral' : 'error'} mono size="sm">
                      {p.email}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={handleClose}>{messages.common.cancel}</Button>
              <Button variant="primary" onClick={handleBulk} disabled={submitting || validEmails.length === 0}>
                {inv.sendBulk}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
