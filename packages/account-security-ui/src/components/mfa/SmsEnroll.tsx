import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, OtpInput, Spinner } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import type { AuthMethods, MfaClient } from '../../types'
import { classifyCodeFailure } from '../../api/errors'
import {
  Actions,
  CardHeading,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  Hint,
  InlineError,
  SeamCard,
  useInFlight,
  useSecurityClient,
} from '../common/flowKit'
import { maskPhone } from './factorMeta'
import { useMfaNav } from './MfaOverview'
import { usePendingFactor } from './pendingFactor'
import type { EnrollFlowProps } from './TotpEnroll'

/**
 * HONEST DEGRADE: text-message delivery is not configured in every environment
 * (it is absent in prod today). When `methods.mfa.types` lacks `sms` the whole
 * flow renders this notice with a DISABLED phone field and routes to the
 * authenticator app — a code is never sent that cannot be delivered.
 */
export function ChannelUnavailableNotice({ onUseAuthenticator, onBack }: { onUseAuthenticator: () => void; onBack: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <SeamCard data-component="channel-unavailable" data-state="channel-unavailable" data-channel="sms" data-available="false">
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <span aria-hidden="true">💬</span>
        <div>
          <CardHeading>{m.mfa.sms.unavailableTitle}</CardHeading>
          <Hint>{m.mfa.sms.unavailableText}</Hint>
          <Actions style={{ marginBlockStart: 0 }}>
            <Button variant="primary" data-action="use-authenticator" onClick={onUseAuthenticator}>
              {m.mfa.sms.useAuthenticator}
            </Button>
            <Button variant="ghost" data-action="back" onClick={onBack}>
              {m.mfa.sms.back}
            </Button>
          </Actions>
        </div>
      </div>
      <div aria-disabled="true" style={{ marginBlockStart: 'var(--space-5)' }}>
        <Input
          label={m.mfa.sms.phoneLabel}
          type="tel"
          placeholder={m.mfa.sms.phonePlaceholder}
          disabled
        />
        <Hint style={{ marginBlockStart: 'var(--space-2)' }}>{m.mfa.sms.phoneDisabledHint}</Hint>
      </div>
    </SeamCard>
  )
}

export interface SmsEnrollPanelProps {
  step: 'enter-phone' | 'confirm-code'
  phone: string
  onPhone: (v: string) => void
  onSendCode: () => void
  sending?: boolean
  sendFailed?: boolean
  onActivate: (code: string) => void
  onResend: () => void
  onCancel: () => void
  activating?: boolean
  invalid?: boolean
  /** The submission failed for a non-rejection reason (5xx / 429 / network): retryable. */
  serviceError?: boolean
}

export function SmsEnrollPanel(p: SmsEnrollPanelProps) {
  const { messages: m, t } = useAccountSecurityI18n()
  const [code, setCode] = useState('')
  if (p.step === 'enter-phone') {
    return (
      <SeamCard data-component="sms-enroll" data-state="enter-phone" data-available="true">
        <p style={{ margin: '0 0 var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
          <b style={{ color: 'var(--text-primary)' }}>{m.mfa.sms.stepNumber}</b> › {m.mfa.sms.stepConfirm}
        </p>
        <Input
          id="sms-phone"
          label={m.mfa.sms.phoneLabel}
          type="tel"
          autoComplete="tel"
          placeholder={m.mfa.sms.phonePlaceholder}
          value={p.phone}
          onChange={(e) => p.onPhone(e.target.value)}
          disabled={p.sending}
          data-field="phone"
        />
        <Hint style={{ marginBlockStart: 'var(--space-2)' }}>{m.mfa.sms.phoneHint}</Hint>
        {p.sendFailed && (
          <InlineError data-state="error-send">
            {m.mfa.sms.sendFailedTitle}. {m.mfa.sms.sendFailedText}
          </InlineError>
        )}
        <Actions style={{ marginBlockStart: 0 }}>
          <Button
            variant="primary"
            data-action="send-code"
            onClick={p.onSendCode}
            disabled={p.sending || p.phone.replace(/\D/g, '').length < 6}
            aria-busy={p.sending || undefined}
            leadingIcon={p.sending ? <Spinner size={16} label={m.mfa.sms.sending} /> : undefined}
          >
            {p.sending ? m.mfa.sms.sending : m.mfa.sms.sendCode}
          </Button>
          <Button variant="ghost" data-action="cancel" onClick={p.onCancel} disabled={p.sending}>
            {m.mfa.sms.cancel}
          </Button>
        </Actions>
      </SeamCard>
    )
  }
  return (
    <SeamCard
      data-component="sms-enroll"
      data-state={p.invalid ? 'error-invalid' : p.serviceError ? 'error-service' : 'confirm-code'}
      data-available="true"
    >
      <p style={{ margin: '0 0 var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
        {m.mfa.sms.stepNumber} › <b style={{ color: 'var(--text-primary)' }}>{m.mfa.sms.stepConfirm}</b>
      </p>
      <label style={{ display: 'block', margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
        {t(m.mfa.sms.confirmLabel, { phone: maskPhone(p.phone) })}
      </label>
      <OtpInput value={code} onChange={setCode} error={p.invalid} disabled={p.activating} autoFocus />
      {p.invalid && <InlineError data-error="invalid-code">{m.mfa.sms.invalid}</InlineError>}
      {p.serviceError && <InlineError data-error="service-error">{m.mfa.sms.serviceError}</InlineError>}
      <Hint style={{ marginBlockStart: 'var(--space-3)' }}>
        {m.mfa.sms.resendPrompt}{' '}
        <a
          href="#resend"
          data-action="resend-code"
          aria-disabled={p.activating ? 'true' : 'false'}
          onClick={(e) => {
            e.preventDefault()
            if (!p.activating) p.onResend()
          }}
          style={{ color: p.activating ? 'var(--text-tertiary)' : 'var(--accent-color)', pointerEvents: p.activating ? 'none' : 'auto' }}
        >
          {m.mfa.sms.resend}
        </a>{' '}
        — {m.mfa.sms.resendHint}
      </Hint>
      <Actions style={{ marginBlockStart: 0 }}>
        <Button
          variant="primary"
          data-action="activate-factor"
          onClick={() => p.onActivate(code)}
          disabled={p.activating || !OtpInput.isComplete(code, 6)}
          aria-busy={p.activating || undefined}
        >
          {p.activating ? m.mfa.totp.activating : m.mfa.sms.activate}
        </Button>
      </Actions>
    </SeamCard>
  )
}

type SmsPhase =
  | { name: 'loading' }
  | { name: 'load-failed' }
  | { name: 'unavailable' }
  | { name: 'enter-phone'; sending: boolean; failed: boolean }
  | { name: 'confirm-code'; factorId: string; activating: boolean; invalid: boolean; serviceError?: boolean }

/**
 * Add a phone for text-message codes (frame 03). LEADS with the channel check:
 * the entire flow is gated on `methods.mfa.types` including `sms`. Wrong / expired
 * code fails closed (inline error, factor stays pending).
 */
export function SmsEnrollFlow(props: EnrollFlowProps) {
  return (
    <FlowRoot locale={props.locale}>
      <SmsEnrollInner {...props} />
    </FlowRoot>
  )
}

function SmsEnrollInner(props: EnrollFlowProps) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<MfaClient>(props.client, props.getToken)
  const { routes, go } = useMfaNav(props)
  const [phase, setPhase] = useState<SmsPhase>({ name: 'loading' })
  const [phone, setPhone] = useState('')
  const alive = useRef(true)
  const pending = usePendingFactor(api)
  // send/resend and activate mutate the same pending factor: they serialize, and a
  // factor whose activation is in flight is never discarded by a resend.
  const inFlight = useInFlight()

  const load = useCallback(async () => {
    setPhase({ name: 'loading' })
    try {
      const methods: AuthMethods = await api.getMethods()
      if (!alive.current) return
      setPhase(
        methods.mfa.types.includes('sms')
          ? { name: 'enter-phone', sending: false, failed: false }
          : { name: 'unavailable' }
      )
    } catch {
      // Cannot confirm the channel → fail closed (never offer a send we can't verify).
      if (alive.current) setPhase({ name: 'load-failed' })
    }
  }, [api])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])

  const sendCode = () =>
    inFlight(async () => {
    setPhase({ name: 'enter-phone', sending: true, failed: false })
    try {
      pending.discard() // a resend replaces the previous pending factor
      const res = await api.enrollFactor({ type: 'sms', phone })
      pending.track(res.factorId)
      setPhase({ name: 'confirm-code', factorId: res.factorId, activating: false, invalid: false })
    } catch {
      setPhase({ name: 'enter-phone', sending: false, failed: true })
    }
    })

  const activate = (factorId: string, code: string) =>
    inFlight(async () => {
    setPhase({ name: 'confirm-code', factorId, activating: true, invalid: false })
    try {
      const factor = await api.activateFactor(factorId, code)
      pending.clear()
      if (props.onActivated) props.onActivated(factor)
      else go(routes.overview)
    } catch (err) {
      // Fail closed: the factor stays pending. A rejected code (400/401/403/422)
      // shows the wrong-or-expired error; 5xx / 429 / network is a retryable
      // service error that does not claim the code was wrong.
      const invalid = classifyCodeFailure(err) === 'invalid'
      setPhase({ name: 'confirm-code', factorId, activating: false, invalid, serviceError: !invalid })
    }
    })

  return (
    <FlowPage title={m.mfa.sms.title} subtitle={m.mfa.sms.subtitle} data-frame="03-sms-enroll">
      {phase.name === 'loading' && (
        <div role="status" aria-busy="true" data-state="loading">
          <Spinner label={m.mfa.overview.loadingLabel} />
        </div>
      )}
      {phase.name === 'load-failed' && (
        <ErrorWithRetry
          data-state="error"
          title={m.mfa.overview.errorTitle}
          text={m.mfa.overview.errorText}
          retryLabel={m.mfa.overview.retry}
          onRetry={() => void load()}
        />
      )}
      {phase.name === 'unavailable' && (
        <ChannelUnavailableNotice
          onUseAuthenticator={() => go(routes.addAuthenticator)}
          onBack={() => go(routes.overview)}
        />
      )}
      {phase.name === 'enter-phone' && (
        <SmsEnrollPanel
          step="enter-phone"
          phone={phone}
          onPhone={setPhone}
          sending={phase.sending}
          sendFailed={phase.failed}
          onSendCode={() => void sendCode()}
          onActivate={() => undefined}
          onResend={() => undefined}
          onCancel={() => {
            pending.discard()
            go(routes.overview)
          }}
        />
      )}
      {phase.name === 'confirm-code' && (
        <SmsEnrollPanel
          step="confirm-code"
          phone={phone}
          onPhone={setPhone}
          activating={phase.activating}
          invalid={phase.invalid}
          serviceError={phase.serviceError}
          onSendCode={() => undefined}
          onActivate={(code) => void activate(phase.factorId, code)}
          onResend={() => void sendCode()}
          onCancel={() => {
            pending.discard()
            go(routes.overview)
          }}
        />
      )}
    </FlowPage>
  )
}
