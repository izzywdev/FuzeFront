import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SignUpFlow } from './SignUpFlow'
import { buildPolicyRules, meetsPolicy, DEFAULT_PASSWORD_POLICY } from './policy'
import { DEFAULT_SIGNUP_LABELS } from './labels'
import { FullNameField } from '../fields/FullNameField'
import { InlineAvailabilityField } from '../fields/InlineAvailabilityField'
import { PasswordPolicyChecklist } from '../fields/PasswordPolicyChecklist'
import { TurnstileField, TURNSTILE_TEST_SITE_KEY } from '../fields/TurnstileField'
import { VerifyGateBanner } from '../fields/VerifyGateBanner'
import { SocialButton } from '../SocialButton'
import type { AuthMethods, AuthTransport, AuthenticatedSession } from '../../types'

// ── Turnstile stub: capture the callbacks the real widget would invoke ────────
const ts = vi.hoisted(() => ({
  props: null as null | Record<string, (...a: unknown[]) => void> & { siteKey: string; options: Record<string, unknown> },
  reset: vi.fn(),
}))
vi.mock('@marsidev/react-turnstile', async () => {
  const R = await import('react')
  return {
    Turnstile: R.forwardRef((props: never, ref: React.Ref<unknown>) => {
      ts.props = props
      R.useImperativeHandle(ref, () => ({ reset: ts.reset }))
      return R.createElement('div', { 'data-testid': 'ts-widget' })
    }),
  }
})
const solveCaptcha = (token = 'cf-token-1') => act(() => ts.props!.onSuccess(token))

const SESSION: AuthenticatedSession = {
  status: 'authenticated',
  token: 'tok',
  user: { id: 'u1', email: 'ada@lovelace.io', roles: [] },
}
const STRONG = 'Corr3ct-Horse!Batt'

function methods(over: Partial<AuthMethods> = {}): AuthMethods {
  return {
    password: true,
    social: ['google'],
    mfa: { enabled: false, types: [] },
    verification: { email: true, sms: false },
    passwordPolicy: { ...DEFAULT_PASSWORD_POLICY },
    ...over,
  }
}
const CAPTCHA = { provider: 'turnstile' as const, siteKey: 'site-key-123' }

function makeTransport(over: Partial<AuthTransport> = {}): AuthTransport {
  return {
    login: vi.fn(),
    signup: vi.fn().mockResolvedValue(SESSION),
    getAuthMethods: vi.fn().mockResolvedValue(methods()),
    startSocial: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}
const httpErr = (status: number, code?: string) => Object.assign(new Error('boom'), { status, code })

function setup(
  props: Partial<React.ComponentProps<typeof SignUpFlow>> = {},
  transport: AuthTransport = makeTransport(),
) {
  const onAuthenticated = vi.fn()
  const utils = render(
    <SignUpFlow
      transport={transport}
      onAuthenticated={onAuthenticated}
      methods={methods()}
      checkDebounceMs={5}
      {...props}
    />,
  )
  const $ = (sel: string) => utils.container.querySelector(sel) as HTMLElement
  return { ...utils, $, transport, onAuthenticated }
}

function fill(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(name), { target: { value } })
}
function fillValid({ withName = true }: { withName?: boolean } = {}) {
  if (withName) fireEvent.change(document.querySelector('[data-field="full-name"]')!, { target: { value: 'Ada Lovelace' } })
  fill('Work email', 'ada@lovelace.io')
  fill('Password', STRONG)
  fill('Confirm password', STRONG)
}
const submitBtn = () => document.querySelector('[data-action="submit"]') as HTMLButtonElement

beforeEach(() => {
  ts.props = null
  ts.reset.mockClear()
})

describe('SignUpFlow — empty / initial state', () => {
  it('renders the frame hooks, submit disabled, every requirement unmet, name optional with no error', () => {
    const { $ } = setup()
    expect($('[data-frame="01-signup"]')).toHaveAttribute('data-state', 'signup-initial')
    expect($('[data-form="signup"]')).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
    const reqs = Array.from(document.querySelectorAll('[data-pwreq] [data-req]'))
    expect(reqs.map(r => r.getAttribute('data-req'))).toEqual(['length', 'upper', 'lower', 'digit', 'symbol'])
    expect(reqs.every(r => r.getAttribute('data-met') === 'false')).toBe(true)
    expect(document.querySelector('[data-pwmeter]')).toHaveAttribute('data-strength', 'empty')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does NOT render Turnstile when AuthMethods.captcha is absent', () => {
    setup()
    expect(document.querySelector('[data-turnstile]')).toBeNull()
  })

  it('the full-name field is ONE optional input with autoComplete=name and a localizable label + help', () => {
    setup()
    const name = document.querySelector('[data-field="full-name"]') as HTMLInputElement
    expect(name).toHaveAttribute('autocomplete', 'name')
    expect(name).not.toBeRequired()
    expect(name).toHaveAccessibleName(/Full name/)
    expect(name).toHaveAccessibleDescription(DEFAULT_SIGNUP_LABELS.fullNameHelp)
    // no given/family split anywhere
    expect(document.querySelectorAll('input[autocomplete="given-name"], input[autocomplete="family-name"]').length).toBe(0)
  })
})

describe('SignUpFlow — password policy, strength, confirm', () => {
  it('ticks each requirement live from the authoritative policy', () => {
    setup()
    const met = (id: string) => document.querySelector(`[data-req="${id}"]`)!.getAttribute('data-met')
    fill('Password', 'abc')
    expect([met('length'), met('lower'), met('upper'), met('digit'), met('symbol')]).toEqual(['false', 'true', 'false', 'false', 'false'])
    expect(document.querySelector('[data-pwmeter]')).toHaveAttribute('data-strength', 'weak')
    fill('Password', STRONG)
    expect(['length', 'upper', 'lower', 'digit', 'symbol'].every(id => met(id) === 'true')).toBe(true)
    expect(document.querySelector('[data-pwmeter]')).toHaveAttribute('data-strength', 'strong')
  })

  it('renders ONLY the rules the policy requires, with its min length (not a hard-coded copy)', () => {
    setup({ methods: methods({ passwordPolicy: { minLength: 8, requireUpper: false, requireLower: true, requireDigit: true, requireSymbol: false } }) })
    expect(Array.from(document.querySelectorAll('[data-pwreq] [data-req]')).map(r => r.getAttribute('data-req'))).toEqual(['length', 'lower', 'digit'])
    expect(screen.getByText('8+ characters')).toBeInTheDocument()
  })

  it('confirm: data-match false + aria-invalid + message on mismatch, true + "Passwords match." on match', () => {
    setup()
    fill('Password', STRONG)
    fill('Confirm password', 'nope')
    const confirm = screen.getByLabelText('Confirm password')
    expect(confirm).toHaveAttribute('data-match', 'false')
    expect(confirm).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText("Passwords don't match yet.")).toBeInTheDocument()
    fill('Confirm password', STRONG)
    expect(confirm).toHaveAttribute('data-match', 'true')
    expect(screen.getByText('Passwords match.')).toBeInTheDocument()
  })

  it('keeps submit disabled while the confirmation mismatches or the password is weak', () => {
    setup()
    fill('Work email', 'ada@lovelace.io')
    fill('Password', 'weak')
    fill('Confirm password', 'weak')
    expect(submitBtn()).toBeDisabled()
    fill('Password', STRONG)
    expect(submitBtn()).toBeDisabled() // confirm now mismatches
    fill('Confirm password', STRONG)
    expect(submitBtn()).toBeEnabled()
  })

  it('policy helpers: buildPolicyRules + meetsPolicy', () => {
    const rules = buildPolicyRules(undefined, DEFAULT_SIGNUP_LABELS)
    expect(rules.map(r => r.id)).toEqual(['length', 'upper', 'lower', 'digit', 'symbol'])
    expect(meetsPolicy(STRONG, rules)).toBe(true)
    expect(meetsPolicy('Short1!', rules)).toBe(false)
  })
})

describe('SignUpFlow — Turnstile (only when AuthMethods.captcha)', () => {
  it('renders the shell in loading, passes the server siteKey, keeps submit disabled until verified', async () => {
    setup({ methods: methods({ captcha: CAPTCHA }) })
    const box = document.querySelector('[data-turnstile]')!
    expect(box).toHaveAttribute('data-state', 'loading')
    expect(ts.props!.siteKey).toBe('site-key-123')
    expect(ts.props!.options.appearance).toBe('interaction-only')
    fillValid()
    expect(submitBtn()).toBeDisabled() // everything valid, challenge not solved
    await solveCaptcha()
    expect(box).toHaveAttribute('data-state', 'verified')
    expect(submitBtn()).toBeEnabled()
  })

  it('an expired token disables submit again; an errored widget shows failed + the retry message', async () => {
    setup({ methods: methods({ captcha: CAPTCHA }) })
    fillValid()
    await solveCaptcha()
    expect(submitBtn()).toBeEnabled()
    act(() => ts.props!.onExpire())
    expect(submitBtn()).toBeDisabled()
    act(() => ts.props!.onError())
    expect(document.querySelector('[data-turnstile]')).toHaveAttribute('data-state', 'failed')
    expect(screen.getByText('Please complete the challenge to continue.')).toBeInTheDocument()
  })

  it('shows ready when the widget needs interaction', () => {
    setup({ methods: methods({ captcha: CAPTCHA }) })
    act(() => ts.props!.onBeforeInteractive())
    expect(document.querySelector('[data-turnstile]')).toHaveAttribute('data-state', 'ready')
  })

  it('sends the token as turnstileToken', async () => {
    const { transport } = setup({ methods: methods({ captcha: CAPTCHA }) })
    fillValid()
    await solveCaptcha('cf-abc')
    fireEvent.click(submitBtn())
    await waitFor(() => expect(transport.signup).toHaveBeenCalled())
    expect(transport.signup).toHaveBeenCalledWith({
      email: 'ada@lovelace.io',
      password: STRONG,
      name: 'Ada Lovelace',
      turnstileToken: 'cf-abc',
    })
  })

  it('TurnstileField defaults to the Cloudflare TEST key (dev default)', () => {
    render(<TurnstileField onToken={() => {}} />)
    expect(ts.props!.siteKey).toBe(TURNSTILE_TEST_SITE_KEY)
    expect(TURNSTILE_TEST_SITE_KEY).toBe('1x00000000000000000000AA')
  })

  it('TurnstileField resets the widget and drops the token when resetSignal bumps', () => {
    const onToken = vi.fn()
    const { rerender } = render(<TurnstileField onToken={onToken} resetSignal={0} />)
    rerender(<TurnstileField onToken={onToken} resetSignal={1} />)
    expect(ts.reset).toHaveBeenCalledTimes(1)
    expect(onToken).toHaveBeenCalledWith(null)
  })
})

describe('SignUpFlow — submit + request shape', () => {
  it('sends { email, password, name } (no firstName/lastName, no turnstileToken without captcha) and reports meta', async () => {
    const { transport, onAuthenticated } = setup()
    fillValid()
    fireEvent.click(submitBtn())
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled())
    const req = (transport.signup as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(req).toEqual({ email: 'ada@lovelace.io', password: STRONG, name: 'Ada Lovelace', turnstileToken: undefined })
    expect(req).not.toHaveProperty('firstName')
    expect(req).not.toHaveProperty('lastName')
    expect(onAuthenticated).toHaveBeenCalledWith(SESSION, { mode: 'signup', email: 'ada@lovelace.io' })
  })

  it('an empty full name is omitted (it is optional) and never blocks submit', async () => {
    const { transport } = setup()
    fillValid({ withName: false })
    fireEvent.click(submitBtn())
    await waitFor(() => expect(transport.signup).toHaveBeenCalled())
    expect((transport.signup as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBeUndefined()
  })

  it('in-flight: button disabled + busy + spinner label, root state submit-inflight', async () => {
    let resolve: (s: AuthenticatedSession) => void = () => {}
    const transport = makeTransport({ signup: vi.fn(() => new Promise<AuthenticatedSession>(r => (resolve = r))) })
    const { $ } = setup({}, transport)
    fillValid()
    fireEvent.click(submitBtn())
    await waitFor(() => expect(submitBtn()).toHaveAttribute('data-state', 'submit-inflight'))
    expect(submitBtn()).toBeDisabled()
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true')
    expect(submitBtn()).toHaveTextContent('Creating account…')
    expect($('[data-frame="01-signup"]')).toHaveAttribute('data-state', 'submit-inflight')
    await act(async () => resolve(SESSION))
  })

  it('cannot be double-submitted while in flight', async () => {
    const transport = makeTransport({ signup: vi.fn(() => new Promise<AuthenticatedSession>(() => {})) })
    setup({}, transport)
    fillValid()
    fireEvent.click(submitBtn())
    fireEvent.submit(document.querySelector('[data-form="signup"]')!)
    expect(transport.signup).toHaveBeenCalledTimes(1)
  })
})

describe('SignUpFlow — error states are explicit, never a crash or a blank', () => {
  it('409 conflict -> "sign in instead" card with sign-in + reset links', async () => {
    const onSignInInstead = vi.fn()
    const transport = makeTransport({ signup: vi.fn().mockRejectedValue(httpErr(409, 'CONFLICT')) })
    setup({ onSignInInstead, resetPasswordHref: '/reset' }, transport)
    fillValid()
    fireEvent.click(submitBtn())
    const card = await screen.findByRole('alert')
    expect(card).toHaveAttribute('data-state', 'signup-conflict')
    expect(card).toHaveTextContent('That account already exists.')
    fireEvent.click(screen.getAllByRole('link', { name: 'Sign in' })[0])
    expect(onSignInInstead).toHaveBeenCalled()
    expect(card.querySelector('[data-nav="reset"]')).toHaveAttribute('href', '/reset')
  })

  it.each([
    ['422 PASSWORD_POLICY', httpErr(422, 'PASSWORD_POLICY')],
    ['400 MALFORMED (weak password)', httpErr(400, 'MALFORMED')],
  ])('weak password rejected on submit (%s) -> post-submit alert + unmet items highlighted + token reset', async (_n, err) => {
    const transport = makeTransport({ signup: vi.fn().mockRejectedValue(err) })
    setup({ methods: methods({ captcha: CAPTCHA }) }, transport)
    fillValid()
    await solveCaptcha()
    fireEvent.click(submitBtn())
    const alert = await screen.findByRole('alert', {}, { timeout: 2000 })
    expect(alert).toHaveAttribute('data-state', 'signup-pw-weak-submit')
    expect(alert).toHaveTextContent("That password doesn't meet our requirements.")
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(ts.reset).toHaveBeenCalled()) // tokens are single-use
    expect(submitBtn()).toBeDisabled() // until a fresh token arrives
  })

  it('503 provider unavailable -> fail-closed card with "Continue with Google" fallback; retry restores the form with values kept', async () => {
    const transport = makeTransport({ signup: vi.fn().mockRejectedValue(httpErr(503, 'PROVIDER_UNAVAILABLE')) })
    const { $ } = setup({}, transport)
    fillValid()
    fireEvent.click(submitBtn())
    await waitFor(() => expect($('[data-state="signup-service-unavailable"]')).not.toBeNull())
    expect(screen.getByText("We couldn't create your account right now.")).toBeInTheDocument()
    expect($('[data-form="signup"]')).toBeNull() // fails closed: no form to re-fire blindly
    fireEvent.click($('[data-action="social-google"]'))
    expect(transport.startSocial).toHaveBeenCalledWith('google')
    fireEvent.click($('[data-action="retry"]'))
    expect($('[data-form="signup"]')).not.toBeNull()
    expect(screen.getByLabelText('Work email')).toHaveValue('ada@lovelace.io')
    expect(screen.getByLabelText('Password')).toHaveValue(STRONG)
  })

  it('503 with Google NOT available offers retry only', async () => {
    const transport = makeTransport({ signup: vi.fn().mockRejectedValue(httpErr(503)), startSocial: undefined })
    const { $ } = setup({}, transport)
    fillValid()
    fireEvent.click(submitBtn())
    await waitFor(() => expect($('[data-state="signup-service-unavailable"]')).not.toBeNull())
    expect($('[data-action="social-google"]')).toBeNull()
    expect($('[data-action="retry"]')).not.toBeNull()
  })

  it('429 -> warning, generic -> error alert; the form stays usable', async () => {
    const t429 = makeTransport({ signup: vi.fn().mockRejectedValue(httpErr(429)) })
    const a = setup({}, t429)
    fillValid()
    fireEvent.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'rate-limited')
    expect(a.$('[data-form="signup"]')).not.toBeNull()
    a.unmount()

    const tBoom = makeTransport({ signup: vi.fn().mockRejectedValue(new Error('kaput')) })
    setup({}, tBoom)
    fillValid()
    fireEvent.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'form-error')
  })

  it('400 CAPTCHA_FAILED with a captcha present -> Turnstile failed state + a fresh challenge', async () => {
    const transport = makeTransport({ signup: vi.fn().mockRejectedValue(httpErr(400, 'CAPTCHA_FAILED')) })
    setup({ methods: methods({ captcha: CAPTCHA }) }, transport)
    fillValid()
    await solveCaptcha()
    fireEvent.click(submitBtn())
    await waitFor(() => expect(document.querySelector('[data-turnstile]')).toHaveAttribute('data-state', 'failed'))
    await waitFor(() => expect(ts.reset).toHaveBeenCalled())
  })
})

describe('SignUpFlow — capabilities', () => {
  it('fetches AuthMethods itself when none are passed; submit waits for them, then honours the captcha', async () => {
    const transport = makeTransport({ getAuthMethods: vi.fn().mockResolvedValue(methods({ captcha: CAPTCHA })) })
    render(<SignUpFlow transport={transport} onAuthenticated={vi.fn()} />)
    fillValid()
    expect(submitBtn()).toBeDisabled() // methods not settled / challenge unsolved
    await waitFor(() => expect(document.querySelector('[data-turnstile]')).not.toBeNull())
    expect(transport.getAuthMethods).toHaveBeenCalledTimes(1)
  })

  it('a failed capability fetch degrades to the default policy rather than a blank form', async () => {
    const transport = makeTransport({ getAuthMethods: vi.fn().mockRejectedValue(new Error('down')) })
    render(<SignUpFlow transport={transport} onAuthenticated={vi.fn()} />)
    await waitFor(() => expect(submitBtn()).toBeDisabled())
    expect(document.querySelectorAll('[data-pwreq] [data-req]').length).toBe(5)
    fillValid()
    await waitFor(() => expect(submitBtn()).toBeEnabled())
  })

  it('hides Google unless startSocial exists AND methods.social advertises it', () => {
    const a = setup({ methods: methods({ social: [] }) })
    expect(a.$('[data-action="social-google"]')).toBeNull()
    a.unmount()
    const b = setup({ social: false })
    expect(b.$('[data-action="social-google"]')).toBeNull()
    b.unmount()
    const c = setup()
    expect(c.$('[data-action="social-google"]')).not.toBeNull()
  })

  it('renders no vendor identity-provider name in the DOM', () => {
    const { container } = setup({ methods: methods({ captcha: CAPTCHA }) })
    expect(container.textContent).not.toMatch(/authentik/i)
  })
})

describe('InlineAvailabilityField — debounced, fail-open', () => {
  const Harness = ({ check, ...p }: { check?: React.ComponentProps<typeof InlineAvailabilityField>['check'] } & Partial<React.ComponentProps<typeof InlineAvailabilityField>>) => {
    const [v, setV] = React.useState('')
    return <InlineAvailabilityField value={v} onChange={setV} check={check} debounceMs={5} {...p} />
  }
  const type = (value: string) => fireEvent.change(screen.getByLabelText('Work email'), { target: { value } })
  const wrapper = () => document.querySelector('[data-avail-state]')!

  it('idle -> checking -> available (success ring + status chip)', async () => {
    let release: (v: { available: boolean }) => void = () => {}
    const check = vi.fn(() => new Promise<{ available: boolean }>(r => (release = r)))
    render(<Harness check={check} />)
    expect(wrapper()).toHaveAttribute('data-avail-state', 'idle')
    type('ada@lovelace.io')
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-avail-state', 'checking'))
    expect(document.querySelector('[data-avail="checking"]')).toHaveTextContent('Checking…')
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-busy', 'true')
    await act(async () => release({ available: true }))
    expect(wrapper()).toHaveAttribute('data-avail-state', 'available')
    expect(document.querySelector('[data-avail="available"]')).toHaveTextContent('Available')
    expect(check).toHaveBeenCalledWith('ada@lovelace.io', expect.any(AbortSignal))
  })

  it('taken -> aria-invalid + "Sign in instead?" (advisory; does not claim to block)', async () => {
    const onSignInInstead = vi.fn()
    render(<Harness check={() => Promise.resolve({ available: false })} onSignInInstead={onSignInInstead} />)
    type('founder@fuzefront.com')
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-avail-state', 'taken'))
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true')
    expect(document.querySelector('[data-avail="taken"]')).toHaveTextContent('Already registered')
    fireEvent.click(document.querySelector('[data-action="signin-instead"]')!)
    expect(onSignInInstead).toHaveBeenCalled()
  })

  it('FAIL-OPEN: a rejected lookup (e.g. 429/5xx) shows "couldn\'t check" and never throws', async () => {
    render(<Harness check={() => Promise.reject(httpErr(429))} />)
    type('ada@lovelace.io')
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-avail-state', 'error'))
    expect(document.querySelector('[data-avail="error"]')).toHaveTextContent("Couldn't check right now")
    expect(screen.getByLabelText('Work email')).not.toHaveAttribute('aria-invalid')
  })

  it('FAIL-OPEN end-to-end: an availability error never blocks submit', async () => {
    const transport = makeTransport({ checkEmailAvailable: vi.fn().mockRejectedValue(httpErr(500)) })
    setup({}, transport)
    fillValid()
    await waitFor(() => expect(document.querySelector('[data-avail-state="error"]')).not.toBeNull())
    expect(submitBtn()).toBeEnabled()
    fireEvent.click(submitBtn())
    await waitFor(() => expect(transport.signup).toHaveBeenCalled())
  })

  it('TAKEN end-to-end: advisory only — submit stays enabled (the 409 is the authority)', async () => {
    const transport = makeTransport({ checkEmailAvailable: vi.fn().mockResolvedValue({ available: false }) })
    setup({}, transport)
    fillValid()
    await waitFor(() => expect(document.querySelector('[data-avail-state="taken"]')).not.toBeNull())
    expect(submitBtn()).toBeEnabled()
  })

  it('debounces: a burst of keystrokes fires ONE lookup, only for the final well-formed address', async () => {
    const check = vi.fn().mockResolvedValue({ available: true })
    render(<Harness check={check} debounceMs={30} />)
    for (const v of ['a', 'ad', 'ada@', 'ada@l', 'ada@lovelace.io']) type(v)
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-avail-state', 'available'))
    expect(check).toHaveBeenCalledTimes(1)
    expect(check.mock.calls[0][0]).toBe('ada@lovelace.io')
  })

  it('discards a stale response when the user keeps typing', async () => {
    const resolvers: Array<(v: { available: boolean }) => void> = []
    const check = vi.fn(() => new Promise<{ available: boolean }>(r => resolvers.push(r)))
    render(<Harness check={check} />)
    type('first@example.com')
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1))
    type('second@example.com')
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    await act(async () => resolvers[0]({ available: false })) // stale: must be ignored
    expect(wrapper()).not.toHaveAttribute('data-avail-state', 'taken')
    await act(async () => resolvers[1]({ available: true }))
    expect(wrapper()).toHaveAttribute('data-avail-state', 'available')
  })

  it('editing the address resets to idle; no checker => never shows an availability signal', async () => {
    const check = vi.fn().mockResolvedValue({ available: true })
    const { unmount } = render(<Harness check={check} />)
    type('ada@lovelace.io')
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-avail-state', 'available'))
    type('ada@lovelace')
    expect(wrapper()).toHaveAttribute('data-avail-state', 'idle')
    unmount()
    render(<Harness />)
    type('ada@lovelace.io')
    await new Promise(r => setTimeout(r, 30))
    expect(wrapper()).toHaveAttribute('data-avail-state', 'idle')
  })
})

describe('06-states.html data-state hooks (frontend-test-engineer drives Playwright against these)', () => {
  it('email availability: email-idle -> email-checking -> email-available / email-taken / email-check-error', async () => {
    const results: Array<() => Promise<{ available: boolean }>> = [
      () => Promise.resolve({ available: true }),
      () => Promise.resolve({ available: false }),
      () => Promise.reject(httpErr(500)),
    ]
    let i = 0
    const transport = makeTransport({ checkEmailAvailable: vi.fn(() => results[i++]()) })
    setup({}, transport)
    const wrap = () => document.querySelector('[data-avail-state]')!
    expect(wrap()).toHaveAttribute('data-state', 'email-idle')
    for (const expected of ['email-available', 'email-taken', 'email-check-error']) {
      fill('Work email', `user${i}@lovelace.io`)
      await waitFor(() => expect(wrap()).toHaveAttribute('data-state', expected))
    }
  })

  it('pw-weak / pw-strong on the meter, confirm-mismatch on the confirm field', () => {
    setup()
    fill('Password', 'abc')
    expect(document.querySelector('[data-state="pw-weak"]')).toHaveAttribute('data-pwmeter')
    fill('Password', STRONG)
    expect(document.querySelector('[data-state="pw-strong"]')).toHaveAttribute('data-pwmeter')
    fill('Confirm password', 'different')
    expect(document.querySelector('[data-state="confirm-mismatch"]')).toBe(screen.getByLabelText('Confirm password'))
    fill('Confirm password', STRONG)
    expect(document.querySelector('[data-state="confirm-mismatch"]')).toBeNull()
  })

  it('the signup-initial root state flips to editing once the user types', () => {
    const { $ } = setup()
    expect($('[data-frame="01-signup"]')).toHaveAttribute('data-state', 'signup-initial')
    fill('Work email', 'a@b.co')
    expect($('[data-frame="01-signup"]')).toHaveAttribute('data-state', 'editing')
  })
})

describe('field components', () => {
  it('FullNameField is controlled and exposes the test hook', () => {
    const onChange = vi.fn()
    render(<FullNameField value="" onChange={onChange} />)
    fireEvent.change(document.querySelector('[data-field="full-name"]')!, { target: { value: '李小龍' } })
    expect(onChange).toHaveBeenCalledWith('李小龍')
  })

  it('PasswordPolicyChecklist builds its rules from the policy and localizes the screen-reader suffixes', () => {
    render(
      <PasswordPolicyChecklist
        value="abc"
        policy={{ minLength: 6, requireUpper: false, requireLower: true, requireDigit: false, requireSymbol: false }}
        labels={{ reqMet: ' — تم', reqUnmet: ' — لم يتم', reqLength: n => `${n}+ حرفًا` }}
      />,
    )
    expect(screen.getByText('6+ حرفًا')).toBeInTheDocument()
    expect(document.querySelector('[data-req="length"]')).toHaveAttribute('data-met', 'false')
    expect(document.querySelector('[data-req="lower"]')).toHaveAttribute('data-met', 'true')
    expect(screen.getByText('— تم')).toBeInTheDocument()
  })

  it('SocialButton exposes its hook and swaps to the pending label', () => {
    const { rerender } = render(<SocialButton label="Continue with Google" onClick={() => {}} />)
    expect(document.querySelector('[data-action="social-google"]')).toHaveTextContent('Continue with Google')
    rerender(<SocialButton label="Continue with Google" pendingLabel="Redirecting…" pending onClick={() => {}} />)
    expect(document.querySelector('[data-action="social-google"]')).toHaveTextContent('Redirecting…')
  })

  it('VerifyGateBanner: explains the gate, resends, then confirms', async () => {
    const onResend = vi.fn().mockResolvedValue(undefined)
    render(<VerifyGateBanner email="ada@lovelace.io" onResend={onResend} />)
    const banner = document.querySelector('[data-state="unverified-gate"]')!
    expect(banner).toHaveTextContent('Verify your email to continue')
    expect(banner).toHaveTextContent('ada@lovelace.io')
    fireEvent.click(banner.querySelector('[data-action="resend"]')!)
    await waitFor(() => expect(banner).toHaveTextContent('A new link is on its way.'))
    expect(onResend).toHaveBeenCalledTimes(1)
  })

  it('VerifyGateBanner: a failed resend leaves the button available to retry', async () => {
    const onResend = vi.fn().mockRejectedValue(new Error('x'))
    render(<VerifyGateBanner email="a@b.co" onResend={onResend} />)
    fireEvent.click(document.querySelector('[data-action="resend"]')!)
    await waitFor(() => expect(onResend).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelector('[data-action="resend"]')).toBeEnabled())
  })
})

describe('i18n + RTL', () => {
  const AR = {
    heading: 'أنشئ حسابك',
    fullNameLabel: 'الاسم الكامل',
    fullNameOptional: 'اختياري',
    emailLabel: 'البريد الإلكتروني للعمل',
    passwordLabel: 'كلمة المرور',
    confirmLabel: 'تأكيد كلمة المرور',
    submit: 'إنشاء حساب',
    reqLength: (n: number) => `${n}+ حرفًا`,
  }

  it('routes every label through the injected labels (no hard-coded English leaks when overridden)', () => {
    setup({ labels: AR })
    expect(screen.getByRole('heading', { name: 'أنشئ حسابك' })).toBeInTheDocument()
    expect(screen.getByLabelText('البريد الإلكتروني للعمل')).toBeInTheDocument()
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument()
    expect(screen.getByLabelText('تأكيد كلمة المرور')).toBeInTheDocument()
    expect(submitBtn()).toHaveTextContent('إنشاء حساب')
    expect(screen.getByText('12+ حرفًا'.replace('12', '12'))).toBeInTheDocument()
  })

  it('under dir="rtl" the form uses logical properties only (no physical left/right) so it mirrors', () => {
    const { container } = render(
      <div dir="rtl">
        <SignUpFlow
          transport={makeTransport()}
          onAuthenticated={vi.fn()}
          methods={methods({ captcha: CAPTCHA })}
          labels={AR}
        />
      </div>,
    )
    // type into the email so the valid adornment renders too
    fill('البريد الإلكتروني للعمل', 'ada@lovelace.io')
    const physical = /(margin|padding)-(left|right)|(^|[;\s])(left|right)\s*:|text-align:\s*(left|right)|border-(left|right)/i
    const offenders = Array.from(container.querySelectorAll<HTMLElement>('[style]'))
      .map(el => el.getAttribute('style') ?? '')
      .filter(style => physical.test(style))
    expect(offenders).toEqual([])
  })
})
