import { useState } from 'react'
import { Button, Input } from '@fuzefront/design-system'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'
import { ErrorCodeTag } from '../common/ErrorCodeTag'

export interface SecretFieldProps {
  keyName: string
  /** Whether a value is currently stored — the ONLY existence signal for a secret; `value` is never sent. */
  isSet: boolean
  /**
   * A stored value that cannot currently be decrypted (key material
   * unavailable). Distinct from `!isSet` — the host sets this from whatever
   * signal it has (e.g. a failed reveal); the frozen contract has no field
   * for it today (SECRET_UNAVAILABLE is an anticipated error code — see the
   * package README).
   */
  unavailable?: boolean
  /** This caller may write (`set`/`unset`) at this scope. */
  editable?: boolean
  /**
   * This caller may reveal the plaintext. Reveal is a separate, anticipated
   * capability (FF-EPIC-18-S1) — omit `onReveal` entirely while it does not
   * exist yet; a `canReveal={true}` with no `onReveal` still renders no
   * button, so the UI never offers an action with nothing behind it.
   */
  canReveal?: boolean
  onReplace: (newValue: string) => void
  onClear: () => void
  /** Resolves the plaintext for a one-time reveal. Omit while the endpoint doesn't exist. */
  onReveal?: (reason: string) => Promise<string>
}

/**
 * The write-only secret field in every state the contract (and the
 * commissioned reveal/redaction model) requires — 08-secret-input.html.
 * `value` is never rendered because it is never sent: `isSet` is the only
 * existence signal, and a "set" secret has no show/reveal toggle on the
 * masked field itself (the browser never received anything to show).
 */
export function SecretField({
  keyName,
  isSet,
  unavailable = false,
  editable = true,
  canReveal = false,
  onReplace,
  onClear,
  onReveal,
}: SecretFieldProps) {
  const { messages } = useConfigI18n()
  const m = messages.secret
  const [mode, setMode] = useState<'idle' | 'replacing' | 'revealing' | 'revealed'>('idle')
  const [draft, setDraft] = useState('')
  const [revealReason, setRevealReason] = useState('')
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  const showReveal = canReveal && Boolean(onReveal)

  if (mode === 'replacing') {
    return (
      <div data-state="secret-replacing">
        <Input
          type="password"
          autoComplete="off"
          placeholder={m.savePlaceholder}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          data-secret-input={keyName}
        />
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', margin: 'var(--space-2) 0' }}>
          {m.replacingHint}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="sm" onClick={() => { setMode('idle'); setDraft('') }} data-action="cancel-replace">
            {messages.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={!draft}
            aria-disabled={!draft || undefined}
            onClick={() => {
              onReplace(draft)
              setDraft('')
              setMode('idle')
            }}
            data-action="save-secret"
          >
            {messages.common.save}
          </Button>
        </div>
      </div>
    )
  }

  if (mode === 'revealing') {
    return (
      <div data-state="reveal-once">
        <div
          role="alertdialog"
          aria-label={m.revealConfirmTitle}
          data-reveal-confirm
          style={{
            border: '1px solid var(--warning-color)',
            background: 'var(--warning-soft)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
          }}
        >
          <b style={{ display: 'block', marginBottom: 'var(--space-2)' }}>{m.revealConfirmTitle}</b>
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>{m.revealConfirmBody}</p>
          <Input
            label={m.revealReasonPlaceholder}
            placeholder={m.revealReasonPlaceholder}
            value={revealReason}
            onChange={e => setRevealReason(e.target.value)}
            data-reveal-reason
          />
          {revealError && <p role="alert" style={{ color: 'var(--error-color)', fontSize: 'var(--text-xs)' }}>{revealError}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <Button variant="ghost" size="sm" onClick={() => { setMode('idle'); setRevealReason('') }} data-action="cancel-reveal">
              {messages.common.cancel}
            </Button>
            <Button
              size="sm"
              disabled={!revealReason}
              aria-disabled={!revealReason || undefined}
              onClick={async () => {
                if (!onReveal) return
                setRevealError(null)
                try {
                  const value = await onReveal(revealReason)
                  setRevealedValue(value)
                  setMode('revealed')
                } catch (err) {
                  setRevealError(err instanceof Error ? err.message : String(err))
                }
              }}
              data-action="confirm-reveal"
            >
              {m.revealAction}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'revealed' && revealedValue !== null) {
    return (
      <div data-state="reveal-once">
        <div
          data-revealed-value
          style={{
            border: '1px solid var(--cyan-400, var(--accent-2))',
            background: 'var(--bg-quaternary)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
          }}
        >
          <b style={{ display: 'block', marginBottom: 'var(--space-2)' }}>{m.revealOnceLabel}</b>
          <p
            data-secret-plaintext
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              wordBreak: 'break-all',
              margin: '0 0 var(--space-3)',
            }}
          >
            {revealedValue}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigator.clipboard?.writeText(revealedValue)}
              data-action="copy-secret"
            >
              {messages.common.copy}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode('idle')
                setRevealedValue(null)
                setRevealReason('')
              }}
              data-action="dismiss-reveal"
            >
              {m.dismissReveal}
            </Button>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
            {m.revealOnceNote}
          </p>
        </div>
      </div>
    )
  }

  // idle: unset / set / unavailable
  if (!isSet) {
    return (
      <div data-state="secret-unset">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="muted" data-secret-state="unset" style={{ color: 'var(--text-tertiary)' }}>
            {m.unset}
          </span>
          {editable && (
            <Button size="sm" onClick={() => setMode('replacing')} data-action="set-secret">
              {m.setAction}
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (unavailable) {
    return (
      <div data-state="secret-unavailable">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span data-secret-state="unavailable" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
            ••••••••••••••••
          </span>
          <Button size="sm" aria-disabled="true" disabled data-action="reveal-secret">
            {m.revealAction}
          </Button>
        </div>
        <p
          data-error-code="SECRET_UNAVAILABLE"
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            border: '1px solid var(--warning-color)',
            background: 'var(--warning-soft)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
          }}
        >
          <b style={{ display: 'block' }}>{m.unavailableTitle}</b>
          <span>
            <ErrorCodeTag code="SECRET_UNAVAILABLE" /> {m.unavailableBody}
          </span>
        </p>
      </div>
    )
  }

  return (
    <div data-state="secret-set">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          data-secret-state="set"
          data-secret-mask={keyName}
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', letterSpacing: 'var(--tracking-wide)' }}
        >
          ••••••••••••••••
        </span>
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => setMode('replacing')} data-action="replace-secret">
            {m.replace}
          </Button>
        )}
        {editable && (
          <Button size="sm" variant="ghost" onClick={onClear} data-op="unset">
            {m.clear}
          </Button>
        )}
        {showReveal && (
          <Button size="sm" variant="ghost" onClick={() => setMode('revealing')} data-action="reveal-secret">
            {m.revealAction}
          </Button>
        )}
      </div>
      {!showReveal && canReveal === false && (
        <p
          data-error-code="FORBIDDEN"
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            border: '1px solid var(--accent-color)',
            background: 'var(--accent-soft)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
          }}
          data-state="reveal-forbidden"
        >
          <b style={{ display: 'block' }}>{m.forbiddenRevealTitle}</b>
          <span>
            <ErrorCodeTag code="FORBIDDEN" /> {m.forbiddenRevealBody}
          </span>
        </p>
      )}
    </div>
  )
}
