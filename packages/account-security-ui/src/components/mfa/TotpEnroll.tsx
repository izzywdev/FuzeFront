import { useCallback, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { Button, OtpInput, QrCode, Spinner } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { isInvalidCode } from '../../api/errors'
import type { MfaClient, MfaEnrollResult, MfaFactor } from '../../types'
import {
  Actions,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  InlineError,
  SeamCard,
  useInFlight,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { groupSecret } from './factorMeta'
import { useMfaNav, type MfaNavProps } from './MfaOverview'
import { usePendingFactor } from './pendingFactor'

/** Build the QR module matrix for an `otpauth://` URI (encoder lives here, not in the DS). */
export function buildQrMatrix(uri: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(uri)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** QR + hand-entry setup key + copy (QrProvisioning). The secret is never logged. */
export function QrProvisioning({ uri, secret }: { uri: string; secret: string }) {
  const { messages: m } = useAccountSecurityI18n()
  const matrix = useMemo(() => buildQrMatrix(uri), [uri])
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      /* clipboard unavailable: the key is visible for manual entry */
    }
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)', alignItems: 'flex-start' }}>
      <div data-provisioning-uri={uri.split('?')[0]}>
        <QrCode modules={matrix} label={m.mfa.totp.qrLabel} />
      </div>
      <div style={{ flex: 1, minWidth: 'calc(var(--space-12) * 4)' }}>
        <p style={{ marginBlockStart: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {m.mfa.totp.instructions}
        </p>
        <div
          data-component="setup-key"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <code
            data-secret
            dir="ltr"
            aria-label={m.mfa.totp.setupKey}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
          >
            {groupSecret(secret)}
          </code>
          <Button variant="ghost" size="sm" data-action="copy-secret" onClick={() => void copy()}>
            {copied ? m.mfa.totp.copied : m.mfa.totp.copy}
          </Button>
        </div>
      </div>
    </div>
  )
}

export interface TotpEnrollPanelProps {
  enroll: MfaEnrollResult
  onActivate: (code: string) => void
  onCancel: () => void
  activating?: boolean
  /** True after a wrong / expired code — fail-closed, the factor is NOT active. */
  invalid?: boolean
  onCodeChange?: () => void
}

export function TotpEnrollPanel({ enroll, onActivate, onCancel, activating, invalid, onCodeChange }: TotpEnrollPanelProps) {
  const { messages: m } = useAccountSecurityI18n()
  const [code, setCode] = useState('')
  return (
    <SeamCard data-component="totp-enroll" data-state={invalid ? 'error-invalid' : 'scan'}>
      <p style={{ margin: '0 0 var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
        <b style={{ color: 'var(--text-primary)' }}>{m.mfa.totp.stepScan}</b> › {m.mfa.totp.stepConfirm}
      </p>
      {enroll.provisioningUri && enroll.secret && (
        <QrProvisioning uri={enroll.provisioningUri} secret={enroll.secret} />
      )}
      <div data-step="verify" style={{ marginBlockStart: 'var(--space-6)' }}>
        <label
          style={{ display: 'block', margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}
        >
          {m.mfa.totp.codeLabel}
        </label>
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v)
            onCodeChange?.()
          }}
          error={invalid}
          disabled={activating}
          autoFocus
        />
        {invalid && <InlineError data-error="invalid-code">{m.mfa.totp.invalid}</InlineError>}
        <Actions>
          <Button
            variant="primary"
            data-action="activate-factor"
            onClick={() => onActivate(code)}
            disabled={activating || !OtpInput.isComplete(code, 6)}
            aria-busy={activating || undefined}
            leadingIcon={activating ? <Spinner size={16} label={m.mfa.totp.activating} /> : undefined}
          >
            {activating ? m.mfa.totp.activating : invalid ? m.mfa.totp.tryAgain : m.mfa.totp.activate}
          </Button>
          <Button variant="ghost" data-action="cancel" onClick={onCancel} disabled={activating}>
            {m.mfa.totp.cancel}
          </Button>
        </Actions>
      </div>
    </SeamCard>
  )
}

export interface EnrollFlowProps extends FlowBaseProps, MfaNavProps {
  /** Called with the activated factor. Defaults to navigating to the overview. */
  onActivated?: (factor: MfaFactor) => void
}

/**
 * Add an authenticator app (frame 02): enrol a TOTP factor, show QR + setup key,
 * then activate with a 6-digit code. A wrong / expired code fails closed — the
 * factor stays pending (inactive), the page stays put, an inline error shows.
 */
export function TotpEnrollFlow(props: EnrollFlowProps) {
  return (
    <FlowRoot locale={props.locale}>
      <TotpEnrollInner {...props} />
    </FlowRoot>
  )
}

type TotpPhase =
  | { name: 'intro' }
  | { name: 'starting' }
  | { name: 'start-failed' }
  | { name: 'scan'; enroll: MfaEnrollResult; activating: boolean; invalid: boolean }
  | { name: 'activate-failed'; enroll: MfaEnrollResult; code: string }

function TotpEnrollInner(props: EnrollFlowProps) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<MfaClient>(props.client, props.getToken)
  const { routes, go } = useMfaNav(props)
  const [phase, setPhase] = useState<TotpPhase>({ name: 'intro' })
  const pending = usePendingFactor(api)
  const inFlight = useInFlight()

  // The factor (and its secret) is created ONLY when the user explicitly starts
  // setup — merely opening the route creates nothing to clean up.
  const start = useCallback(() => inFlight(async () => {
    setPhase({ name: 'starting' })
    try {
      const enroll = await pending.enrolling(api.enrollFactor({ type: 'totp' }))
      pending.track(enroll.factorId)
      setPhase({ name: 'scan', enroll, activating: false, invalid: false })
    } catch {
      setPhase({ name: 'start-failed' })
    }
  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  [api])

  const cancel = () => {
    pending.discard()
    go(routes.overview)
  }

  const activate = (enroll: MfaEnrollResult, code: string) => inFlight(async () => {
    setPhase({ name: 'scan', enroll, activating: true, invalid: false })
    try {
      const factor = await pending.activating(api.activateFactor(enroll.factorId, code))
      pending.clear()
      if (props.onActivated) props.onActivated(factor)
      else go(routes.overview)
    } catch (err) {
      if (isInvalidCode(err)) setPhase({ name: 'scan', enroll, activating: false, invalid: true })
      else setPhase({ name: 'activate-failed', enroll, code })
    }
  })

  return (
    <FlowPage title={m.mfa.totp.title} subtitle={m.mfa.totp.subtitle} data-frame="02-totp-enroll">
      {phase.name === 'intro' && (
        <SeamCard data-component="totp-enroll" data-state="intro">
          <p style={{ margin: '0 0 var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
            {m.mfa.totp.introText}
          </p>
          <Actions style={{ marginBlockStart: 0 }}>
            <Button variant="primary" data-action="start-setup" onClick={() => void start()}>
              {m.mfa.overview.enrollFirst}
            </Button>
            <Button variant="ghost" data-action="cancel" onClick={() => go(routes.overview)}>
              {m.mfa.totp.cancel}
            </Button>
          </Actions>
        </SeamCard>
      )}
      {phase.name === 'starting' && (
        <div role="status" aria-busy="true" data-state="loading">
          <Spinner label={m.mfa.overview.loadingLabel} />
        </div>
      )}
      {phase.name === 'start-failed' && (
        <ErrorWithRetry
          data-state="error"
          title={m.mfa.totp.startFailedTitle}
          text={m.mfa.totp.startFailedText}
          retryLabel={m.mfa.totp.tryAgain}
          onRetry={() => void start()}
        />
      )}
      {phase.name === 'scan' && (
        <TotpEnrollPanel
          enroll={phase.enroll}
          activating={phase.activating}
          invalid={phase.invalid}
          onActivate={(code) => void activate(phase.enroll, code)}
          onCancel={cancel}
        />
      )}
      {phase.name === 'activate-failed' && (
        <ErrorWithRetry
          data-state="error"
          title={m.mfa.totp.startFailedTitle}
          text={m.mfa.totp.startFailedText}
          retryLabel={m.mfa.totp.tryAgain}
          onRetry={() => void activate(phase.enroll, phase.code)}
        />
      )}
    </FlowPage>
  )
}
