import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, OtpInput, Skeleton, Spinner } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import type { AuthMethods, ContactClient, MfaClient } from '../../types'
import { classifyCodeFailure } from '../../api/errors'
import {
  Actions,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  Hint,
  InlineError,
  SeamCard,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { isSendablePhone, maskPhone, normalizePhone } from './factorMeta'
import { ChannelUnavailableNotice } from './SmsEnroll'

type PanelState = 'enter-phone' | 'sending' | 'enter-code' | 'verifying' | 'error-invalid' | 'error-service' | 'error-send' | 'verified'

export interface ContactVerifyPanelProps {
  state: PanelState
  phone: string
  onPhone: (v: string) => void
  onSendCode: () => void
  onVerify: (code: string) => void
  onResend: () => void
  /** Back to the editable phone entry (after a delivery failure). */
  onChangeNumber?: () => void
  onSkip?: () => void
  onContinue?: () => void
}

/** Phone OTP verification panel (ContactVerifyPanel) — touch-sized at 375px. */
export function ContactVerifyPanel(p: ContactVerifyPanelProps) {
  const { messages: m, t } = useAccountSecurityI18n()
  const [code, setCode] = useState('')
  const masked = maskPhone(p.phone)
  useEffect(() => {
    if (p.state === 'sending') setCode('')
  }, [p.state])
  const showHeaderSkip = (p.state === 'enter-phone' || p.state === 'enter-code') && p.onSkip

  return (
    <div data-panel="confirm-contact" data-state={p.state} data-channel="phone">
      <SeamCard flush>
        {showHeaderSkip && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockEnd: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" data-action="skip" onClick={p.onSkip}>
              {m.contact.skip}
            </Button>
          </div>
        )}

        {p.state === 'enter-phone' && (
          <>
            <Hint>{m.contact.enterPhonePrompt}</Hint>
            <Input
              id="phone"
              label={m.contact.phoneLabel}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={m.contact.phonePlaceholder}
              value={p.phone}
              onChange={(e) => p.onPhone(e.target.value)}
            />
            {p.phone.trim() !== '' && !isSendablePhone(p.phone) && (
              <Hint data-hint="phone-format" style={{ color: 'var(--error-color)' }}>{m.contact.phoneFormat}</Hint>
            )}
            <Actions>
              <Button
                variant="primary"
                fullWidth
                data-action="send-code"
                onClick={p.onSendCode}
                disabled={!isSendablePhone(p.phone)}
              >
                {m.contact.sendCode}
              </Button>
            </Actions>
          </>
        )}

        {p.state === 'sending' && (
          <div role="status" aria-busy="true" aria-label={m.contact.sendingLabel}>
            <Skeleton width="80%" height="var(--space-4)" />
            <div style={{ height: 'var(--space-2)' }} />
            <Skeleton width="55%" height="var(--space-4)" />
          </div>
        )}

        {(p.state === 'enter-code' || p.state === 'verifying' || p.state === 'error-invalid' || p.state === 'error-service') && (
          <>
            <Hint>{t(m.contact.enterCodePrompt, { phone: masked })}</Hint>
            <OtpInput
              size="touch"
              value={code}
              onChange={setCode}
              error={p.state === 'error-invalid'}
              disabled={p.state === 'verifying'}
              autoFocus
            />
            {p.state === 'error-invalid' && <InlineError data-error="invalid-code">{m.contact.invalid}</InlineError>}
            {p.state === 'error-service' && <InlineError data-error="service-error">{m.contact.serviceError}</InlineError>}
            <Actions style={{ flexDirection: 'column' }}>
              <Button
                variant="primary"
                fullWidth
                data-action="verify-contact"
                onClick={() => p.onVerify(code)}
                disabled={p.state === 'verifying' || !OtpInput.isComplete(code, 6)}
                aria-busy={p.state === 'verifying' || undefined}
                leadingIcon={p.state === 'verifying' ? <Spinner size={16} label={m.contact.confirming} /> : undefined}
              >
                {p.state === 'verifying'
                  ? m.contact.confirming
                  : p.state === 'error-invalid' || p.state === 'error-service'
                    ? m.contact.tryAgain
                    : m.contact.confirm}
              </Button>
              <Button variant="ghost" fullWidth data-action="resend" onClick={p.onResend} disabled={p.state === 'verifying'}>
                {m.contact.resend}
              </Button>
            </Actions>
          </>
        )}

        {p.state === 'error-send' && (
          <>
            <InlineError>{m.contact.sendFailedText}</InlineError>
            <Actions style={{ flexDirection: 'column' }}>
              <Button variant="primary" fullWidth data-action="send-code" onClick={p.onSendCode}>
                {m.contact.tryAgain}
              </Button>
              <Button variant="ghost" fullWidth data-action="change-number" onClick={p.onChangeNumber}>
                {m.contact.changeNumber}
              </Button>
              {p.onSkip && (
                <Button variant="ghost" fullWidth data-action="skip" onClick={p.onSkip}>
                  {m.contact.skip}
                </Button>
              )}
            </Actions>
          </>
        )}

        {p.state === 'verified' && (
          <>
            <p style={{ color: 'var(--success-color)', fontWeight: 'var(--weight-semibold)' }}>
              ✓{' '}
              {p.phone ? t(m.contact.verifiedText, { phone: masked }) : m.contact.verifiedFallback}
            </p>
            <Actions>
              <Button variant="primary" fullWidth data-action="continue" onClick={p.onContinue}>
                {m.contact.continue}
              </Button>
            </Actions>
          </>
        )}
      </SeamCard>
    </div>
  )
}

export interface ConfirmContactFlowProps extends FlowBaseProps {
  /** Skip for now (profile re-prompts until verified). */
  onSkip?: () => void
  /** After "Continue" on the verified state. */
  onDone?: () => void
  /** Offered on the channel-unavailable state to route to the authenticator flow. */
  onUseAuthenticator?: () => void
}

/**
 * Confirm your phone (frame 03, mobile). Phone only — email keeps the approved
 * link-click pattern. enter phone → sending → enter code → verified. Wrong /
 * expired code stays on screen (inline error, no navigation); a generic send
 * failure offers retry or skip — never a silent hang. Skip is always available.
 */
export function ConfirmContactFlow(props: ConfirmContactFlowProps) {
  return (
    <FlowRoot locale={props.locale}>
      <ConfirmContactInner {...props} />
    </FlowRoot>
  )
}

type Capability = 'checking' | 'available' | 'unavailable' | 'failed'

function ConfirmContactInner({ client, getToken, onSkip, onDone, onUseAuthenticator }: ConfirmContactFlowProps) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<ContactClient & Pick<MfaClient, 'getMethods'>>(client, getToken)
  // FAIL CLOSED: nothing is enabled, and nothing (least of all the phone update that
  // `startPhoneVerification` performs before delivery) is sent until the Security API
  // has confirmed text-message delivery is available.
  const [capability, setCapability] = useState<Capability>('checking')
  const alive = useRef(true)
  const checkCapability = useCallback(async () => {
    setCapability('checking')
    try {
      const methods: AuthMethods = await api.getMethods()
      if (alive.current) setCapability(methods.verification?.sms === true ? 'available' : 'unavailable')
    } catch {
      if (alive.current) setCapability('failed')
    }
  }, [api])
  useEffect(() => {
    alive.current = true
    void checkCapability()
    return () => {
      alive.current = false
    }
  }, [checkCapability])
  const [state, setState] = useState<PanelState>('enter-phone')
  const [phone, setPhone] = useState('')

  const send = async () => {
    if (capability !== 'available') return
    setState('sending')
    try {
      await api.startPhoneVerification(normalizePhone(phone))
      setState('enter-code')
    } catch {
      setState('error-send')
    }
  }

  const verify = async (code: string) => {
    if (capability !== 'available') return
    setState('verifying')
    try {
      await api.confirmPhoneVerification(normalizePhone(phone), code)
      setState('verified')
    } catch (err) {
      // Stay on this screen, fail closed: a rejected code is "invalid"; 5xx / 429 /
      // network is a retryable service error (the code was not judged wrong).
      setState(classifyCodeFailure(err) === 'invalid' ? 'error-invalid' : 'error-service')
    }
  }

  return (
    <FlowPage title={m.contact.title} maxWidth="100%" data-frame="03-confirm-contact" data-viewport="375">
      {capability === 'checking' && (
        <div data-panel="confirm-contact" data-state="checking" role="status" aria-busy="true" aria-label={m.contact.sendingLabel}>
          <Skeleton width="80%" height="var(--space-4)" />
          <div style={{ height: 'var(--space-2)' }} />
          <Skeleton width="55%" height="var(--space-4)" />
        </div>
      )}
      {capability === 'failed' && (
        <div data-panel="confirm-contact" data-state="capability-error">
          <ErrorWithRetry
            data-state="error"
            title={m.mfa.overview.errorTitle}
            text={m.mfa.overview.errorText}
            retryLabel={m.mfa.overview.retry}
            onRetry={() => void checkCapability()}
          />
          {onSkip && (
            <Actions>
              <Button variant="ghost" data-action="skip" onClick={onSkip}>
                {m.contact.skip}
              </Button>
            </Actions>
          )}
        </div>
      )}
      {capability === 'unavailable' && (
        <div data-panel="confirm-contact" data-state="channel-unavailable" data-channel="phone">
          <ChannelUnavailableNotice onUseAuthenticator={onUseAuthenticator} onBack={() => onSkip?.()} />
        </div>
      )}
      {capability === 'available' && (
      <ContactVerifyPanel
        state={state}
        phone={phone}
        onPhone={setPhone}
        onSendCode={() => void send()}
        onVerify={(c) => void verify(c)}
        onResend={() => void send()}
        onChangeNumber={() => setState('enter-phone')}
        onSkip={onSkip}
        onContinue={onDone}
      />
      )}
    </FlowPage>
  )
}
