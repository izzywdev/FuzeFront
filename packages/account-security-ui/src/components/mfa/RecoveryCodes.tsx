import { useCallback, useEffect, useState } from 'react'
import { Button, Skeleton, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import type { MfaClient, RecoveryCodesStatusResult } from '../../types'
import {
  Actions,
  CardHeading,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  Hint,
  SeamCard,
  useInFlight,
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

export type CountsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; counts: RecoveryCodesStatusResult }

/** "You have **8 of 10** recovery codes left…" (frame 04, returning state). Counts only, never codes. */
function RecoveryCountLine({ counts }: { counts: RecoveryCodesStatusResult }) {
  const { messages: m } = useAccountSecurityI18n()
  const fraction = m.mfa.recovery.statusFraction
    .replace('{remaining}', String(counts.remaining))
    .replace('{total}', String(counts.total))
  const [before, after = ''] = m.mfa.recovery.statusCount.split('{fraction}')
  return (
    <Hint data-value="recovery-count" data-remaining={counts.remaining} data-total={counts.total}>
      {before}
      <b style={{ color: 'var(--text-primary)' }}>{fraction}</b>
      {after}
    </Hint>
  )
}

export function RecoveryCodesStatus({
  onRegenerate,
  counts,
  onRetryCounts,
}: {
  onRegenerate: () => void
  /** Omit to render the count-less description (e.g. when no set was ever generated). */
  counts?: CountsState
  onRetryCounts?: () => void
}) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <SeamCard data-component="recovery-codes" data-state="status">
      {counts?.status === 'loading' ? (
        <div data-state="counts-loading" role="status" aria-busy="true" aria-label={m.mfa.recovery.statusLoadingLabel}>
          <Skeleton width="100%" height="var(--space-6)" radius="var(--radius-md)" />
        </div>
      ) : counts?.status === 'ready' && counts.counts.total > 0 ? (
        <RecoveryCountLine counts={counts.counts} />
      ) : counts?.status === 'error' ? (
        <div data-state="counts-error" role="alert">
          <Hint>{m.mfa.recovery.statusErrorText}</Hint>
          {onRetryCounts && (
            <Button variant="ghost" data-action="retry-counts" onClick={onRetryCounts}>
              {m.mfa.recovery.statusRetry}
            </Button>
          )}
        </div>
      ) : (
        <Hint>{m.mfa.recovery.statusText}</Hint>
      )}
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
  const inFlight = useInFlight()
  const [counts, setCounts] = useState<CountsState>({ status: 'loading' })
  const phaseName = phase.name

  // Counts only (`{remaining,total}`) — the codes themselves are never fetched. Re-read each
  // time the status view is (re)entered, so a regenerate is reflected immediately.
  const loadCounts = useCallback(() => {
    let live = true
    setCounts({ status: 'loading' })
    api
      .getRecoveryCodesStatus()
      .then((c) => live && setCounts({ status: 'ready', counts: c }))
      .catch(() => live && setCounts({ status: 'error' }))
    return () => {
      live = false
    }
  }, [api])
  useEffect(() => (phaseName === 'status' ? loadCounts() : undefined), [phaseName, loadCounts])

  const regenerate = () => inFlight(async () => {
    setPhase({ name: 'confirm', busy: true })
    try {
      const codes = await api.regenerateRecoveryCodes()
      setPhase({ name: 'shown', codes })
    } catch {
      // Nothing was revealed, but a lost response may follow a server commit: the
      // old set may already be invalid. Do NOT reassure; require a successful retry.
      setPhase({ name: 'error' })
    }
  })

  return (
    <FlowPage title={m.mfa.recovery.title} subtitle={m.mfa.recovery.subtitle} data-frame="04-recovery-codes">
      {phase.name === 'status' && (
        <RecoveryCodesStatus
          counts={counts}
          onRetryCounts={loadCounts}
          onRegenerate={() => setPhase({ name: 'confirm', busy: false })}
        />
      )}
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
