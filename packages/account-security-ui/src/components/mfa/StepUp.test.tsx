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

  it('recovery is offered only when the challenge says recoveryAvailable === true (missing/false = hidden)', async () => {
    const user = userEvent.setup()
    for (const flag of [undefined, false] as const) {
      const { unmount } = render(
        <MfaStepUpFlow
          client={asClient(makeClient())}
          challenge={{ challengeId: 'c', factors: [TOTP, SMS], recoveryAvailable: flag }}
          onAuthenticated={vi.fn()}
        />
      )
      await user.click(await screen.findByRole('button', { name: /different method/i }))
      expect(q('[data-factor="recovery"]')).toBeNull()
      unmount()
    }
    render(
      <MfaStepUpFlow
        client={asClient(makeClient())}
        challenge={{ challengeId: 'c', factors: [TOTP, SMS], recoveryAvailable: true }}
        onAuthenticated={vi.fn()}
      />
    )
    await user.click(await screen.findByRole('button', { name: /different method/i }))
    expect(q('[data-factor="recovery"]')).toBeTruthy()
  })
})

describe.each([['desktop', MfaStepUpFlow], ['mobile', MfaStepUpMobileFlow]] as const)(
  'recovery-code entry (%s, frames 07 / 05)',
  (name, Flow) => {
    const mobile = name === 'mobile'
    const root = () =>
      q(mobile ? '[data-panel="recovery-code"]' : '[data-component="mfa-challenge"][data-factor="recovery"]')!
    const stateIs = (desktopState: string, mobileState: string) =>
      root().getAttribute('data-state') === (mobile ? mobileState : desktopState)
    const field = () => q('[data-field="recovery-code"]') as HTMLInputElement
    const verifyBtn = () => q('[data-action="verify-recovery"]') as HTMLButtonElement
    const open = async (
      client: ReturnType<typeof makeClient>,
      extra: { onAuthenticated?: () => void; onBack?: () => void; onContactSupport?: () => void } = {}
    ) => {
      const user = userEvent.setup()
      render(
        <Flow
          client={asClient(client)}
          challenge={{ challengeId: 'chl_9', factors: [TOTP], recoveryAvailable: true }}
          onAuthenticated={extra.onAuthenticated ?? vi.fn()}
          onBack={extra.onBack}
          onContactSupport={extra.onContactSupport}
        />
      )
      const different = screen.queryByRole('button', { name: /different method/i })
      if (different) await user.click(different)
      await user.click((await waitFor(() => q('[data-factor="recovery"]')!)) as Element)
      return user
    }
    const submit = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
      await user.type(field(), code)
      await user.click(verifyBtn())
    }

    it('idle: frame hooks, helper text, one opaque text field with the frame attributes', async () => {
      await open(makeClient())
      expect(stateIs('recovery-prompt', 'idle')).toBe(true)
      expect(q(`[data-frame="${mobile ? '05-recovery-code' : '07-recovery-code-entry'}"]`)).toBeTruthy()
      expect(q('[data-component="recovery-code-input"]')).toBeTruthy()
      expect(q('[data-component="otp-input"]')).toBeNull()
      const f = field()
      expect(f.type).toBe('text')
      expect(f.getAttribute('maxlength')).toBe('64')
      expect(f.getAttribute('autocomplete')).toBe('one-time-code')
      expect(f.getAttribute('autocapitalize')).toBe('none')
      expect(f.getAttribute('spellcheck')).toBe('false')
      expect(f.getAttribute('inputmode')).toBeNull()
      expect(f.getAttribute('placeholder')).toBeNull()
      const help = q('[data-help="recovery-code"]')!
      expect(help.textContent).toBe('Each code works once. Spaces and dashes are fine — type it the way you saved it.')
      expect(f.getAttribute('aria-describedby')).toBe(help.id)
      expect(verifyBtn().disabled).toBe(true)
      expect(q('[data-action="choose-factor"]')).toBeTruthy()
    })

    it('contact support is present on the entry state and calls onContactSupport', async () => {
      const onContactSupport = vi.fn()
      const user = await open(makeClient(), { onContactSupport })
      await user.click(q('[data-action="contact-support"]')!)
      expect(onContactSupport).toHaveBeenCalled()
    })

    it('submits exactly { challengeId, recoveryCode } as typed (trimmed) and proceeds like a factor verify', async () => {
      const client = makeClient()
      const onAuthenticated = vi.fn()
      const user = await open(client, { onAuthenticated })
      await submit(user, ' ab12-CD34 ef ')
      await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 'tok', sessionId: 's1' }))
      expect(client.verifyRecoveryCode).toHaveBeenCalledWith('chl_9', 'ab12-CD34 ef')
      expect(client.verifyMfa).not.toHaveBeenCalled()
    })

    it('Verify is disabled only while the trimmed value is empty (no format check)', async () => {
      const user = await open(makeClient())
      await user.type(field(), '   ')
      expect(verifyBtn().disabled).toBe(true)
      await user.type(field(), 'x')
      expect(verifyBtn().disabled).toBe(false)
    })

    it('verifying: field + button disabled, spinner, and no double submit', async () => {
      let release!: (v: unknown) => void
      const verifyRecoveryCode = vi.fn(() => new Promise((r) => { release = r }))
      const user = await open(makeClient({ verifyRecoveryCode }))
      await user.type(field(), 'abc')
      await user.click(verifyBtn())
      expect(stateIs('recovery-verifying', 'verifying')).toBe(true)
      expect(field().disabled).toBe(true)
      expect(verifyBtn().disabled).toBe(true)
      expect(verifyBtn().getAttribute('aria-busy')).toBe('true')
      await user.keyboard('{Enter}')
      await user.click(verifyBtn())
      expect(verifyRecoveryCode).toHaveBeenCalledTimes(1)
      await act(async () => release({ token: 't' }))
    })

    it('401 RECOVERY_CODE_INVALID: frame copy, no time-based wording, value kept + selected, retry works', async () => {
      const verifyRecoveryCode = vi.fn().mockRejectedValueOnce(err(401, 'RECOVERY_CODE_INVALID')).mockResolvedValueOnce({ token: 't2' })
      const onAuthenticated = vi.fn()
      const user = await open(makeClient({ verifyRecoveryCode }), { onAuthenticated })
      await submit(user, 'wrong')
      await waitFor(() => expect(stateIs('recovery-error-invalid', 'error-invalid')).toBe(true))
      expect(root().getAttribute('data-http-status')).toBe('401')
      const msg = q('[data-error="recovery-invalid"]')!.textContent!
      expect(msg).toContain("That recovery code didn't work. Check it for typos, or try another of your codes — each code works only once.")
      expect(document.body.textContent).not.toMatch(/30 seconds|expired|authenticator/i)
      expect(field().value).toBe('wrong')
      expect(field().getAttribute('aria-invalid')).toBe('true')
      expect(verifyBtn().textContent).toMatch(/try again/i)
      expect(onAuthenticated).not.toHaveBeenCalled()
      await user.click(verifyBtn())
      await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ token: 't2' }))
    })

    it('401 NOT_ACTIVE: neutral "Your sign-in expired" — no field, no claim about the code, Back to sign in', async () => {
      const verifyRecoveryCode = vi.fn(async () => { throw err(401, 'NOT_ACTIVE') })
      const onBack = vi.fn()
      const user = await open(makeClient({ verifyRecoveryCode }), { onBack })
      await submit(user, 'abc')
      await waitFor(() => expect(stateIs('recovery-error-expired', 'error-expired')).toBe(true))
      const text = root().textContent!
      expect(text).toContain('Your sign-in expired')
      expect(text).toContain('Start again to sign in.')
      expect(text).not.toMatch(/\bused\b|unused|consumed|still valid|code (was|is)/i)
      expect(field()).toBeNull()
      expect(q('[data-action="verify-recovery"]')).toBeNull()
      await user.click(q('[data-action="restart-sign-in"]')!)
      expect(onBack).toHaveBeenCalled()
    })

    it('network / 5xx / unrecognised: "We couldn\'t check your code", not a wrong code, never says unused, retry kept', async () => {
      const verifyRecoveryCode = vi.fn()
        .mockRejectedValueOnce(err(503))
        .mockRejectedValueOnce(new TypeError('network'))
        .mockRejectedValueOnce(err(400, 'MALFORMED'))
      const user = await open(makeClient({ verifyRecoveryCode }))
      await user.type(field(), 'abc')
      for (let i = 0; i < 3; i++) {
        await user.click(verifyBtn())
        await waitFor(() => expect(stateIs('recovery-error-generic', 'error-generic')).toBe(true))
        const text = root().textContent!
        expect(text).toContain("We couldn't check your code")
        expect(text).toContain('Something went wrong while checking it. Check your connection and try again.')
        expect(text).not.toMatch(/unused|still valid|wrong code|didn't work/i)
        expect(q('[data-error="recovery-invalid"]')).toBeNull()
        expect(field().value).toBe('abc')
        expect(verifyBtn().disabled).toBe(false)
      }
    })

    it('use a different method returns to the factor picker', async () => {
      const user = await open(makeClient())
      await user.click(q('[data-action="choose-factor"]')!)
      expect(q('[data-component="factor-picker"]')).toBeTruthy()
    })

    it('no listed factors but recoveryAvailable: recovery is offered (not the dead-end state)', async () => {
      render(
        <Flow client={asClient(makeClient())} challenge={{ challengeId: 'c', factors: [], recoveryAvailable: true }} onAuthenticated={vi.fn()} />
      )
      await waitFor(() => expect(q('[data-factor="recovery"]')).toBeTruthy())
      expect(q('[data-state="empty"]')).toBeNull()
    })
  }
)

describe.each([
  ['desktop factor code', MfaStepUpFlow, 'factor'],
  ['mobile factor code', MfaStepUpMobileFlow, 'factor'],
  ['desktop recovery code', MfaStepUpFlow, 'recovery'],
  ['mobile recovery code', MfaStepUpMobileFlow, 'recovery'],
] as const)('429 RATE_LIMITED with a Retry-After countdown (%s)', (_n, Flow, kind) => {
  const recovery = kind === 'recovery'
  const isMobile = Flow === MfaStepUpMobileFlow
  const btn = () => q(recovery ? '[data-action="verify-recovery"]' : '[data-action="verify-mfa"]') as HTMLButtonElement
  const fakeUser = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })

  async function reach429(verify: ReturnType<typeof vi.fn>, onBack = vi.fn()) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = fakeUser()
    const client = makeClient(recovery ? { verifyRecoveryCode: verify } : { verifyMfa: verify })
    render(
      <Flow client={asClient(client)} challenge={{ challengeId: 'chl_1', factors: [TOTP], recoveryAvailable: true }} onAuthenticated={vi.fn()} onBack={onBack} />
    )
    if (recovery) {
      const different = screen.queryByRole('button', { name: /different method/i })
      if (different) await user.click(different)
      await user.click((await waitFor(() => q('[data-factor="recovery"]')!)) as Element)
      await user.type(q('[data-field="recovery-code"]') as Element, 'abc')
    } else {
      if (isMobile) await user.click((await waitFor(() => q('[data-factor="totp"][data-action="challenge"]')!)) as Element)
      await waitFor(() => expect(q('[data-component="otp-input"] input')).toBeTruthy())
      await typeCode(user, '123456')
    }
    await user.click(btn())
    await waitFor(() => expect(q('[data-error="rate-limited"]')).toBeTruthy())
    return { user, onBack }
  }

  it('shows a live m:ss countdown in the callout and on a disabled button, then re-enables', async () => {
    const verify = vi.fn(async () => { throw err(429, 'RATE_LIMITED', 125) })
    await reach429(verify)
    expect(q('[data-value="retry-after"]')!.textContent).toBe('2:05')
    expect(q('[data-error="rate-limited"]')!.textContent).toMatch(/Too many attempts/)
    expect(q('[data-error="rate-limited"]')!.textContent).toMatch(/won't skip the wait/)
    expect(btn().disabled).toBe(true)
    expect(btn().getAttribute('data-state')).toBe('cooldown')
    expect(btn().textContent).toBe('Try again in 2:05')
    expect(q('[data-error="invalid-code"], [data-error="recovery-invalid"]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(q('[data-value="retry-after"]')!.textContent).toBe('2:00')
    expect(btn().textContent).toBe('Try again in 2:00')
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(btn().disabled).toBe(false)
    expect(btn().getAttribute('data-state')).toBeNull()
    expect(btn().textContent).toMatch(/^try again$/i)
  })

  it('exposes the frame hooks (http status 429) and keeps the entered code', async () => {
    const verify = vi.fn(async () => { throw err(429, 'RATE_LIMITED', 30) })
    await reach429(verify)
    const rootEl = isMobile
      ? q(recovery ? '[data-panel="recovery-code"]' : '[data-panel="enter-code"]')!
      : q('[data-component="mfa-challenge"][data-factor]')!
    expect(rootEl.getAttribute('data-http-status')).toBe('429')
    expect(rootEl.getAttribute('data-state')).toBe(recovery && !isMobile ? 'recovery-rate-limited' : 'rate-limited')
    if (recovery) expect((q('[data-field="recovery-code"]') as HTMLInputElement).value).toBe('abc')
    else expect((document.querySelectorAll('[data-component="otp-input"] input')[0] as HTMLInputElement).value).toBe('1')
  })

  it('a repeated 429 restarts the countdown from the new header', async () => {
    const verify = vi.fn().mockRejectedValueOnce(err(429, 'RATE_LIMITED', 10)).mockRejectedValueOnce(err(429, 'RATE_LIMITED', 90))
    const { user } = await reach429(verify)
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(btn().disabled).toBe(false)
    await user.click(btn())
    await waitFor(() => expect(q('[data-value="retry-after"]')!.textContent).toBe('1:30'))
    expect(btn().disabled).toBe(true)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it.each([[undefined], [0]])('missing/invalid Retry-After (%s): "Wait a few minutes, then try again." and the button is enabled', async (ra) => {
    const verify = vi.fn(async () => { throw err(429, 'RATE_LIMITED', ra) })
    await reach429(verify)
    expect(q('[data-value="retry-after"]')).toBeNull()
    expect(q('[data-error="rate-limited"]')!.textContent).toContain('Wait a few minutes, then try again.')
    expect(btn().disabled).toBe(false)
    expect(btn().textContent).toMatch(/^try again$/i)
  })

  it('Back to sign in calls onBack', async () => {
    const verify = vi.fn(async () => { throw err(429, 'RATE_LIMITED', 30) })
    const { user, onBack } = await reach429(verify)
    await user.click(q('[data-action="back-to-sign-in"]')!)
    expect(onBack).toHaveBeenCalled()
  })
})

describe('Retry-After parsing', () => {
  it('reads a positive integer header off a 429 and ignores junk / dates / zero', async () => {
    const { HttpClient } = await import('../../api/http')
    const mk = (h?: string) =>
      new HttpClient({ fetchImpl: (async () => new Response('{"code":"RATE_LIMITED"}', { status: 429, headers: h ? { 'Retry-After': h } : {} })) as never })
    const get = async (h?: string) => (await mk(h).get('/x').catch((e: unknown) => e)) as { retryAfter?: number }
    expect((await get('120')).retryAfter).toBe(120)
    expect((await get()).retryAfter).toBeUndefined()
    expect((await get('0')).retryAfter).toBeUndefined()
    expect((await get('abc')).retryAfter).toBeUndefined()
    expect((await get('Wed, 21 Oct 2026 07:28:00 GMT')).retryAfter).toBeUndefined()
    expect((await get('1.5')).retryAfter).toBeUndefined()
  })
})

describe('classifyCodeFailure / classifyRecoveryFailure', () => {
  it('maps the contract outcomes', async () => {
    const { classifyCodeFailure, classifyRecoveryFailure } = await import('../../api/errors')
    expect(classifyCodeFailure(err(401, 'NOT_ACTIVE'))).toBe('invalid')
    expect(classifyCodeFailure(err(429))).toBe('rate-limited')
    expect(classifyCodeFailure(err(503))).toBe('service')
    expect(classifyRecoveryFailure(err(401, 'RECOVERY_CODE_INVALID'))).toBe('invalid')
    expect(classifyRecoveryFailure(err(401, 'NOT_ACTIVE'))).toBe('expired')
    expect(classifyRecoveryFailure(err(429, 'RATE_LIMITED'))).toBe('rate-limited')
    expect(classifyRecoveryFailure(err(400, 'MALFORMED'))).toBe('service')
    expect(classifyRecoveryFailure(new Error('network'))).toBe('service')
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
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(err(502))
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

  it('resend is ignored while a verification is in flight (no concurrent challenge)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let release!: () => void
    const verifyMfa = vi.fn(() => new Promise((r) => { release = () => r({ token: 't' }) }))
    const client = makeClient({ verifyMfa })
    render(
      <MfaStepUpMobileFlow client={asClient(client)} challenge={{ challengeId: 'c', factors: [SMS] }} onAuthenticated={vi.fn()} />
    )
    await user.click(q('[data-factor="sms"][data-action="challenge"]')!)
    await waitFor(() => expect(q('[data-value="expires-in"]')).toBeTruthy())
    await act(async () => { vi.advanceTimersByTime(31_000) })
    await typeCode(user, '123456')
    await user.click(q('[data-action="verify-mfa"]')!)
    await waitFor(() => expect(verifyMfa).toHaveBeenCalledTimes(1))
    await user.click(q('[data-action="resend"]')!)
    expect(client.challengeMfa).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
  })

  it('hosted: drops its own card chrome on the desktop variant (no nested card), standalone keeps it', async () => {
    const mk = (hosted: boolean) => (
      <MfaStepUpFlow client={asClient(makeClient())} challenge={{ challengeId: 'c', factors: [TOTP] }} onAuthenticated={vi.fn()} hosted={hosted} />
    )
    const { unmount } = render(mk(true))
    await waitFor(() => expect(q('[data-component="mfa-challenge"]')).toBeTruthy())
    expect((q('[data-component="mfa-challenge"]') as HTMLElement).style.overflow).not.toBe('hidden')
    unmount()
    render(mk(false))
    await waitFor(() => expect(q('[data-component="mfa-challenge"]')).toBeTruthy())
    expect((q('[data-component="mfa-challenge"]') as HTMLElement).style.overflow).toBe('hidden')
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
    expect(client.startPhoneVerification).toHaveBeenCalledWith('+15550004471')
    await typeCode(user, '123456')
    await user.click(q('[data-action="verify-contact"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="verified"]')).toBeTruthy())
    expect(client.confirmPhoneVerification).toHaveBeenCalledWith('+15550004471', '123456')
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

  it('a non-E.164 number keeps Send disabled with a format hint', async () => {
    const user = userEvent.setup()
    render(<ConfirmContactFlow client={asClient(makeClient())} />)
    await user.type(q('#phone')!, '555 000 4471')
    expect(q('[data-action="send-code"]')).toBeDisabled()
    expect(q('[data-hint="phone-format"]')).toBeTruthy()
  })

  it('after a send failure "Change number" returns to the editable phone entry and a corrected number is sent', async () => {
    const user = userEvent.setup()
    const startPhoneVerification = vi.fn().mockRejectedValueOnce(err(400)).mockResolvedValueOnce(undefined)
    render(<ConfirmContactFlow client={asClient(makeClient({ startPhoneVerification }))} />)
    await user.type(q('#phone')!, '+1 555 000 4471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="error-send"]')).toBeTruthy())
    await user.click(q('[data-action="change-number"]')!)
    expect(q('[data-panel="confirm-contact"][data-state="enter-phone"]')).toBeTruthy()
    const input = q('#phone') as HTMLInputElement
    expect(input.value).toBe('+1 555 000 4471') // kept, editable
    await user.clear(input)
    await user.type(input, '+15550009999')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-panel="confirm-contact"][data-state="enter-code"]')).toBeTruthy())
    expect(startPhoneVerification).toHaveBeenLastCalledWith('+15550009999')
  })

  it('skip is available on the first step', () => {
    render(<ConfirmContactFlow client={asClient(makeClient())} onSkip={vi.fn()} />)
    expect(q('[data-action="skip"]')).toBeTruthy()
  })
})
