import { useState } from 'react'
import { Button, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import type { MfaClient } from '../../types'
import {
  Actions,
  CardHeading,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  Hint,
  SeamCard,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { useMfaNav, type MfaNavProps } from './MfaOverview'

/** The one-time reveal. Props-only: this component never fetches or stores codes. */
export function RecoveryCodesShownOnce({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  const [copied, setCopied] = useState(false)
  const text = codes.join('\n')

  const download = () => {
    const blob = new Blob([text + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = m.mfa.recovery.fileName
    a.click()
    URL.revokeObjectURL(url)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      /* clipboard unavailable: the codes remain on screen to copy by hand */
    }
  }

  return (
    <SeamCard data-component="recovery-codes" data-state="shown-once">
      <StatusCallout tone="warning" icon="⚠" title={m.mfa.recovery.shownOnceWarning}>
        {m.mfa.recovery.shownOnceText}
      </StatusCallout>
      <ul
        data-codes
        aria-label={m.mfa.recovery.listLabel}
        dir="ltr"
        style={{
          listStyle: 'none',
          margin: 'var(--space-4) 0 0',
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-2)',
        }}
      >
        {codes.map((c) => (
          <li key={c}>
            <code
              style={{
                display: 'block',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {c}
            </code>
          </li>
        ))}
      </ul>
      <Actions>
        <Button variant="primary" data-action="download-codes" onClick={download}>
          {m.mfa.recovery.download}
        </Button>
        <Button variant="ghost" data-action="copy-codes" onClick={() => void copy()}>
          {copied ? m.mfa.recovery.copied : m.mfa.recovery.copy}
        </Button>
        <Button variant="ghost" data-action="print-codes" onClick={() => window.print()}>
          {m.mfa.recovery.print}
        </Button>
        <Button variant="ghost" data-action="codes-saved" onClick={onDone}>
          {m.mfa.recovery.done}
        </Button>
      </Actions>
    </SeamCard>
  )
}

export function RecoveryCodesStatus({ onRegenerate }: { onRegenerate: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <SeamCard data-component="recovery-codes" data-state="status">
      <Hint>{m.mfa.recovery.statusText}</Hint>
      <Actions style={{ marginBlockStart: 0 }}>
        <Button variant="ghost" data-action="regenerate-open" onClick={onRegenerate}>
          {m.mfa.recovery.regenerate}
        </Button>
      </Actions>
    </SeamCard>
  )
}

export function RegenerateConfirm({
  onConfirm,
  onCancel,
  busy,
}: {
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const { messages: m } = useAccountSecurityI18n()
  const [ack, setAck] = useState(false)
  return (
    <SeamCard
      tone="warning"
      data-component="recovery-codes"
      data-state="regenerate-confirm"
      role="alertdialog"
      aria-labelledby="regen-title"
    >
      <CardHeading id="regen-title">{m.mfa.recovery.confirmTitle}</CardHeading>
      <Hint>{m.mfa.recovery.confirmText}</Hint>
      <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: 'var(--text-sm)' }}>
        <input
          type="checkbox"
          data-field="ack-invalidate"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        {m.mfa.recovery.ack}
      </label>
      <Actions>
        <Button
          variant="primary"
          data-action="regenerate-confirm"
          onClick={onConfirm}
          disabled={!ack || busy}
          aria-busy={busy || undefined}
        >
          {busy ? m.mfa.recovery.regenerating : m.mfa.recovery.confirm}
        </Button>
        <Button variant="ghost" data-action="cancel" onClick={onCancel} disabled={busy}>
          {m.mfa.recovery.cancel}
        </Button>
      </Actions>
    </SeamCard>
  )
}

type Phase =
  | { name: 'status' }
  | { name: 'confirm'; busy: boolean }
  | { name: 'error' }
  | { name: 'shown'; codes: string[] }

/**
 * Recovery codes (frame 04) — REVEAL ONCE. The page lands on a STATUS view that
 * neither fetches nor shows codes. Regeneration needs an explicit acknowledgement
 * that the old set stops working; the returned codes live only in this
 * component's state, are rendered once, and are dropped on "I've saved them" or
 * unmount. They are never written to storage and never re-fetched.
 */
export function RecoveryCodesFlow(props: FlowBaseProps & MfaNavProps) {
  return (
    <FlowRoot locale={props.locale}>
      <RecoveryCodesInner {...props} />
    </FlowRoot>
  )
}

function RecoveryCodesInner(props: FlowBaseProps & MfaNavProps) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<MfaClient>(props.client, props.getToken)
  const { routes, go } = useMfaNav(props)
  const [phase, setPhase] = useState<Phase>({ name: 'status' })

  const regenerate = async () => {
    setPhase({ name: 'confirm', busy: true })
    try {
      const codes = await api.regenerateRecoveryCodes()
      setPhase({ name: 'shown', codes })
    } catch {
      // Nothing was revealed and the old set is unchanged server-side.
      setPhase({ name: 'error' })
    }
  }

  return (
    <FlowPage title={m.mfa.recovery.title} subtitle={m.mfa.recovery.subtitle} data-frame="04-recovery-codes">
      {phase.name === 'status' && <RecoveryCodesStatus onRegenerate={() => setPhase({ name: 'confirm', busy: false })} />}
      {phase.name === 'confirm' && (
        <RegenerateConfirm
          busy={phase.busy}
          onConfirm={() => void regenerate()}
          onCancel={() => setPhase({ name: 'status' })}
        />
      )}
      {phase.name === 'error' && (
        <ErrorWithRetry
          data-state="error"
          title={m.mfa.recovery.errorTitle}
          text={m.mfa.recovery.errorText}
          retryLabel={m.mfa.recovery.retry}
          onRetry={() => setPhase({ name: 'confirm', busy: false })}
        />
      )}
      {phase.name === 'shown' && (
        <RecoveryCodesShownOnce
          codes={phase.codes}
          onDone={() => {
            setPhase({ name: 'status' })
            go(routes.overview)
          }}
        />
      )}
    </FlowPage>
  )
}
