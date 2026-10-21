import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FullAccountSecurityClient, MfaFactorRef } from '../../types'
import { err, makeClient } from '../../test/helpers'
import { MfaStepUpFlow, MfaStepUpMobileFlow } from './StepUp'
import { ConfirmContactFlow } from './ConfirmContact'

const asClient = (c: unknown) => c as Partial<FullAccountSecurityClient>
const q = (sel: string) => document.querySelector(sel)
const TOTP: MfaFactorRef = { factorId: 'fct_totp_1', type: 'totp' }
const SMS: MfaFactorRef = { factorId: 'fct_sms_1', type: 'sms' }
const EMAIL: MfaFactorRef = { factorId: 'fct_email_1', type: 'email' }

afterEach(() => vi.useRealTimers())

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(document.querySelector('[data-component="otp-input"] input')!)
  await user.keyboard(code)
}

describe('MfaStepUpFlow (desktop, frame 05)', () => {
  it('lands on the authenticator prompt when TOTP is enrolled, then verifies and hands back the session', async () => {
    const user = userEvent.setup()
    const onAuthenticated = vi.fn()
    const client = makeClient()
    render(
      <MfaStepUpFlow
        client={asClient(client)}
        challenge={{ challengeId: 'chl_1', factors: [TOTP, SMS] }}
        onAuthenticated={onAuthenticated}
      />
    )
    await waitFor(() => expect(q('[data-component="mfa-challenge"][data-state="totp-prompt"]')).toBeTruthy())
    await typeCode(user, '123456')
    await user.click(q('[data-action="verify-mfa"]')!)
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 'tok', sessionId: 's1' }))
    expect(client.verifyMfa).toHaveBeenCalledWith('chl_1', 'fct_totp_1', '123456')
  })

  it('FAIL-CLOSED: a wrong / expired code stays on screen with an inline error and never authenticates', async () => {
    const user = userEvent.setup()
    const onAuthenticated = vi.fn()
    const client = makeClient({ verifyMfa: vi.fn(async () => { throw err(401, 'INVALID_CREDENTIALS') }) })
    render(
      <MfaStepUpFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [TOTP] }} onAuthenticated={onAuthenticated} />
    )
    await waitFor(() => expect(q('[data-action="verify-mfa"]')).toBeTruthy())
    await typeCode(user, '000000')
    await user.click(q('[data-action="verify-mfa"]')!)
    await waitFor(() => expect(q('[data-component="mfa-challenge"][data-state="error-invalid"]')).toBeTruthy())
    expect(q('[data-error="invalid-code"]')).toBeTruthy()
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('"use a different method" shows the picker; choosing SMS dispatches a challenge', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(
      <MfaStepUpFlow client={asClient(client)} challenge={{ challengeId: 'chl_1', factors: [TOTP, SMS] }} onAuthenticated={vi.fn()} />
    )
    await waitFor(() => expect(q('[data-action="choose-factor"]')).toBeTruthy())
    await user.click(q('[data-action="choose-factor"]')!)
    expect(q('[data-component="mfa-challenge"][data-state="choose-factor"]')).toBeTruthy()
    expect(q('[data-component="factor-picker"]')).toBeTruthy()
    await user.click(q('[data-factor="sms"][data-action="challenge"]')!)
    await waitFor(() => expect(client.challengeMfa).toHaveBeenCalledWith('chl_1', 'fct_sms_1'))
  })

  it('SMS delivery failure surfaces and offers other methods', async () => {
    const user = userEvent.setup()
    const client = makeClient({ challengeMfa: vi.fn(async () => { throw err(503, 'PROVIDER_UNAVAILABLE') }) })
    render(<MfaStepUpFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [SMS] }} onAuthenticated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /text message/i }))
    await waitFor(() => expect(q('[data-component="mfa-challenge"][data-state="error-delivery"]')).toBeTruthy())
    expect(q('[data-action="choose-factor"]')).toBeTruthy()
  })

  it('an ack with delivered:false is also a delivery failure (never a silent "sent")', async () => {
    const user = userEvent.setup()
    const client = makeClient({ challengeMfa: vi.fn(async (c: string, f: string) => ({ challengeId: c, factorId: f, delivered: false })) })
    render(<MfaStepUpFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [EMAIL] }} onAuthenticated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /email/i }))
    await waitFor(() => expect(q('[data-state="error-delivery"]')).toBeTruthy())
  })

  it('the recovery option is NOT offered by default (no contract path), only when enabled', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <MfaStepUpFlow client={asClient(makeClient())} challenge={{ challengeId: 'c', factors: [TOTP, SMS] }} onAuthenticated={vi.fn()} />
    )
    await user.click(await screen.findByRole('button', { name: /different method/i }))
    expect(q('[data-factor="recovery"]')).toBeNull()
    unmount()
    render(
      <MfaStepUpFlow
        client={asClient(makeClient())}
        challenge={{ challengeId: 'c', factors: [TOTP, SMS] }}
        onAuthenticated={vi.fn()}
        recoveryEnabled
      />
    )
    await user.click(await screen.findByRole('button', { name: /different method/i }))
    expect(q('[data-factor="recovery"]')).toBeTruthy()
  })
})

describe('step-up empty state is judged on the factors the picker can offer', () => {
  it('a webauthn-only challenge fails closed to support (no empty picker)', () => {
    render(
      <MfaStepUpFlow
        client={asClient(makeClient())}
        challenge={{ challengeId: 'c', factors: [{ factorId: 'w1', type: 'webauthn' }] }}
        onAuthenticated={vi.fn()}
      />
    )
    expect(q('[data-state="empty"]')).toBeTruthy()
    expect(q('[data-action="contact-support"]')).toBeTruthy()
    expect(q('[data-component="factor-picker"]')).toBeNull()
  })

  it('webauthn alongside a supported factor still offers only the supported one', async () => {
    const user = userEvent.setup()
    render(
      <MfaStepUpFlow
        client={asClient(makeClient())}
        challenge={{ challengeId: 'c', factors: [{ factorId: 'w1', type: 'webauthn' }, SMS] }}
        onAuthenticated={vi.fn()}
      />
    )
    expect(q('[data-factor="sms"]')).toBeTruthy()
    expect(q('[data-factor="webauthn"]')).toBeNull()
    await user.click(q('[data-factor="sms"][data-action="challenge"]')!)
  })
})

describe('MfaStepUpMobileFlow (frames 01-02, 375px)', () => {
  it('starts at the picker (loaded): only enrolled factors, touch-height rows', () => {
    render(
      <MfaStepUpMobileFlow
        client={asClient(makeClient())}
        challenge={{ challengeId: 'c', factors: [TOTP, EMAIL, SMS] }}
        onAuthenticated={vi.fn()}
      />
    )
    expect(q('[data-panel="choose-factor"][data-state="loaded"]')).toBeTruthy()
    for (const f of ['totp', 'email', 'sms']) expect(q(`[data-factor="${f}"][data-action="challenge"]`)).toBeTruthy()
    const row = q('[data-factor="totp"]') as HTMLElement
    expect(row.style.minHeight).toContain('--touch-target')
    expect(q('[data-frame="01-choose-factor"]')).toBeTruthy()
  })

  it('loading → error (retry only) → loaded via loadFactors', async () => {
    const user = userEvent.setup()
    const loadFactors = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce([TOTP])
    render(
      <MfaStepUpMobileFlow client={asClient(makeClient())} challenge={{ challengeId: 'c' }} loadFactors={loadFactors} onAuthenticated={vi.fn()} />
    )
    expect(q('[data-panel="choose-factor"][data-state="loading"]')).toBeTruthy()
    await waitFor(() => expect(q('[data-panel="choose-factor"][data-state="error"]')).toBeTruthy())
    expect(q('[data-component="factor-picker"]')).toBeNull() // no silent factor choice
    await user.click(q('[data-action="retry"]')!)
    await waitFor(() => expect(q('[data-panel="choose-factor"][data-state="loaded"]')).toBeTruthy())
  })

  it('zero factors fail closed to support — never a dead end, never an OTP field', async () => {
    const user = userEvent.setup()
    const onContactSupport = vi.fn()
    render(
      <MfaStepUpMobileFlow
        client={asClient(makeClient())}
        challenge={{ challengeId: 'c', factors: [] }}
        onAuthenticated={vi.fn()}
        onContactSupport={onContactSupport}
      />
    )
    expect(q('[data-panel="choose-factor"][data-state="empty"]')).toBeTruthy()
    expect(q('[data-component="otp-input"]')).toBeNull()
    await user.click(q('[data-action="contact-support"]')!)
    expect(onContactSupport).toHaveBeenCalled()
  })

  it('verify disables while in flight (no double-submit), then fails closed on a wrong code', async () => {
    const user = userEvent.setup()
    let release: (e: unknown) => void = () => {}
    const verifyMfa = vi.fn(() => new Promise((_, rej) => { release = rej }))
    render(
      <MfaStepUpMobileFlow client={asClient(makeClient({ verifyMfa }))} challenge={{ challengeId: 'c', factors: [TOTP] }} onAuthenticated={vi.fn()} />
    )
    await user.click(q('[data-factor="totp"][data-action="challenge"]')!)
    await typeCode(user, '123456')
    const verify = q('[data-action="verify-mfa"]') as HTMLButtonElement
    await user.click(verify)
    await waitFor(() => expect(q('[data-panel="enter-code"][data-state="verifying"]')).toBeTruthy())
    expect(verify).toBeDisabled()
    await user.click(verify)
    expect(verifyMfa).toHaveBeenCalledTimes(1)
    await act(async () => release(err(401)))
    await waitFor(() => expect(q('[data-panel="enter-code"][data-state="error-invalid"]')).toBeTruthy())
    expect(q('[data-error="invalid-code"]')).toBeTruthy()
  })

  it('uses touch-sized OTP cells', async () => {
    const user = userEvent.setup()
    render(
      <MfaStepUpMobileFlow client={asClient(makeClient())} challenge={{ challengeId: 'c', factors: [TOTP] }} onAuthenticated={vi.fn()} />
    )
    await user.click(q('[data-factor="totp"][data-action="challenge"]')!)
    const cell = q('[data-component="otp-input"] input') as HTMLInputElement
    expect(cell.style.minWidth).toBe('var(--touch-target)')
  })

  it('code sent: shows the expiry countdown and a resend that is disabled during the cooldown, then enables', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const client = makeClient()
    render(
      <MfaStepUpMobileFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [SMS] }} onAuthenticated={vi.fn()} />
    )
    await user.click(q('[data-factor="sms"][data-action="challenge"]')!)
    await waitFor(() => expect(q('[data-value="expires-in"]')).toBeTruthy())
    expect(q('[data-value="expires-in"]')!.textContent).toContain('05:00')
    expect(q('[data-state="cooldown"] [data-action="resend"]')).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { vi.advanceTimersByTime(31_000) })
    expect(q('[data-action="resend"]')).toHaveAttribute('aria-disabled', 'false')
    await user.click(q('[data-action="resend"]')!)
    await waitFor(() => expect(client.challengeMfa).toHaveBeenCalledTimes(2))
    expect(q('[data-state="cooldown"]')).toBeTruthy()
  })

  it('resend restarts only the cooldown; the challenge expiry keeps counting down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const client = makeClient()
    render(
      <MfaStepUpMobileFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [SMS] }} onAuthenticated={vi.fn()} />
    )
    await user.click(q('[data-factor="sms"][data-action="challenge"]')!)
    await waitFor(() => expect(q('[data-value="expires-in"]')).toBeTruthy())
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(q('[data-value="expires-in"]')!.textContent).toContain('04:0')
    await user.click(q('[data-action="resend"]')!)
    await waitFor(() => expect(client.challengeMfa).toHaveBeenCalledTimes(2))
    expect(q('[data-state="cooldown"]')).toBeTruthy()
    expect(q('[data-value="expires-in"]')!.textContent).not.toContain('05:00')
    expect(q('[data-value="expires-in"]')!.textContent).toContain('04:')
  })

  it('a double-click on a factor issues exactly one challenge request', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const challengeMfa = vi.fn(
      () => new Promise((res) => { release = () => res({ delivered: true }) })
    )
    const client = makeClient({ challengeMfa })
    render(
      <MfaStepUpMobileFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [SMS] }} onAuthenticated={vi.fn()} />
    )
    const btn = q('[data-factor="sms"][data-action="challenge"]') as HTMLButtonElement
    await user.dblClick(btn)
    expect(challengeMfa).toHaveBeenCalledTimes(1)
    expect(btn.disabled).toBe(true)
    await act(async () => { release() })
    await waitFor(() => expect(q('[data-value="expires-in"]')).toBeTruthy())
  })

  it('a 5xx on verify is a retryable service error, not "wrong code"; 4xx stays invalid', async () => {
    const user = userEvent.setup()
    const verifyMfa = vi
      .fn()
      .mockRejectedValueOnce(err(503, 'UNAVAILABLE'))
      .mockRejectedValueOnce(err(429, 'RATE'))
      .mockRejectedValueOnce(new TypeError('network'))
    const client = makeClient({ verifyMfa })
    render(
      <MfaStepUpFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [TOTP] }} onAuthenticated={vi.fn()} />
    )
    await waitFor(() => expect(q('[data-action="verify-mfa"]')).toBeTruthy())
    await typeCode(user, '123456')
    for (let i = 0; i < 3; i++) {
      await user.click(q('[data-action="verify-mfa"]')!)
      await waitFor(() => expect(q('[data-component="mfa-challenge"][data-state="error-service"]')).toBeTruthy())
      expect(q('[data-error="service-error"]')).toBeTruthy()
      expect(q('[data-error="invalid-code"]')).toBeNull()
      // code is kept, verify is retryable
      expect((q('[data-action="verify-mfa"]') as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('expiry applies on the TOTP path too: at zero the flow is expired, verify is gone, restart calls onBack', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onBack = vi.fn()
    const client = makeClient()
    render(
      <MfaStepUpFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [TOTP] }} onAuthenticated={vi.fn()} onBack={onBack} />
    )
    await waitFor(() => expect(q('[data-action="verify-mfa"]')).toBeTruthy())
    await act(async () => { vi.advanceTimersByTime(301_000) })
    expect(q('[data-state="expired"]')).toBeTruthy()
    expect(q('[data-action="verify-mfa"]')).toBeNull()
    expect(q('[data-action="resend"]')).toBeNull()
    await user.click(q('[data-action="restart-sign-in"]')!)
    expect(onBack).toHaveBeenCalled()
    expect(client.verifyMfa).not.toHaveBeenCalled()
  })

  it('delivery failure offers resend and other methods', async () => {
    const user = userEvent.setup()
    const client = makeClient({ challengeMfa: vi.fn(async () => { throw err(503) }) })
    render(<MfaStepUpMobileFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [SMS, TOTP] }} onAuthenticated={vi.fn()} />)
    await user.click(q('[data-factor="sms"][data-action="challenge"]')!)
    await waitFor(() => expect(q('[data-panel="enter-code"][data-state="error-delivery"]')).toBeTruthy())
    expect(q('[data-action="challenge"]')).toBeTruthy()
    await user.click(q('[data-action="choose-factor"]')!)
    expect(q('[data-panel="choose-factor"][data-state="loaded"]')).toBeTruthy()
  })
})

describe('ConfirmContactFlow (frame 03, phone)', () => {
  it('enter phone → sending → enter code → verified → continue', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    const client = makeClient()
    render(<ConfirmContactFlow client={asClient(client)} onDone={onDone} onSkip={vi.fn()} />)
    expect(q('[data-panel="confirm-contact"][data-state="enter-phone"]')).toBeTruthy()
    await user.type(q('#phone')!, '+1 555 000 4471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="enter-code"]')).toBeTruthy())
    expect(client.startPhoneVerification).toHaveBeenCalledWith('+1 555 000 4471')
    await typeCode(user, '123456')
    await user.click(q('[data-action="verify-contact"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="verified"]')).toBeTruthy())
    expect(client.confirmPhoneVerification).toHaveBeenCalledWith('+1 555 000 4471', '123456')
    await user.click(q('[data-action="continue"]')!)
    expect(onDone).toHaveBeenCalled()
  })

  it('FAIL-CLOSED: wrong / expired code → inline error, stays put', async () => {
    const user = userEvent.setup()
    const client = makeClient({ confirmPhoneVerification: vi.fn(async () => { throw err(401) }) })
    render(<ConfirmContactFlow client={asClient(client)} />)
    await user.type(q('#phone')!, '+15550004471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="otp-input"]')).toBeTruthy())
    await typeCode(user, '000000')
    await user.click(q('[data-action="verify-contact"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="error-invalid"]')).toBeTruthy())
    expect(q('[data-error="invalid-code"]')).toBeTruthy()
    expect(q('[data-panel="confirm-contact"][data-state="verified"]')).toBeNull()
  })

  it('a 5xx on confirm is a retryable service error, not "wrong code"', async () => {
    const user = userEvent.setup()
    const client = makeClient({ confirmPhoneVerification: vi.fn(async () => { throw err(503) }) })
    render(<ConfirmContactFlow client={asClient(client)} />)
    await user.type(q('#phone')!, '+15550004471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="otp-input"]')).toBeTruthy())
    await typeCode(user, '123456')
    await user.click(q('[data-action="verify-contact"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="error-service"]')).toBeTruthy())
    expect(q('[data-error="service-error"]')).toBeTruthy()
    expect(q('[data-error="invalid-code"]')).toBeNull()
  })

  it('generic send failure offers retry or skip — never a silent hang', async () => {
    const user = userEvent.setup()
    const onSkip = vi.fn()
    const client = makeClient({ startPhoneVerification: vi.fn(async () => { throw err(500) }) })
    render(<ConfirmContactFlow client={asClient(client)} onSkip={onSkip} />)
    await user.type(q('#phone')!, '+15550004471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="error-send"]')).toBeTruthy())
    expect(document.querySelectorAll('[data-action="skip"]')).toHaveLength(1)
    await user.click(q('[data-action="skip"]')!)
    expect(onSkip).toHaveBeenCalled()
  })

  it('skip is available on the first step', () => {
    render(<ConfirmContactFlow client={asClient(makeClient())} onSkip={vi.fn()} />)
    expect(q('[data-action="skip"]')).toBeTruthy()
  })
})
