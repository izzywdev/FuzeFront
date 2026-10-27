/**
 * LoginPage.auth-experience.test.tsx (FFRNT-360)
 *
 * With `fuzefront.auth.experience` ON: sign-in gets a "Forgot password?" link to
 * /reset, signup renders the redesigned SignUpFlow (optional full name, inline
 * availability, policy checklist, confirm, Turnstile, explicit error states), and
 * a fresh signup with an unverified email is routed to /signup/verify. With it OFF
 * (default) none of that changes today's behaviour.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { AuthMethods } from '@fuzefront/security-client'

vi.mock('../assets/FuzeFrontLogo.svg', () => ({ default: 'mock-logo.png' }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}))
vi.mock('../lib/shared', () => ({ useCurrentUser: vi.fn() }))

// Capture the Turnstile widget's callbacks (the real one loads Cloudflare's script).
const ts = vi.hoisted(() => ({
  props: null as null | Record<string, (...a: unknown[]) => void> & { siteKey: string },
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

import LoginPage from '../pages/LoginPage'
import * as sharedMock from '../lib/shared'
import { authAPI } from '../services/api'

const METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: true, sms: false },
}

function setLocation(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, search: '', href: `https://app.fuzefront.com${path}` },
  })
}

function setFlag(on: boolean | undefined) {
  const w = window as unknown as { __FF_AUTH_EXPERIENCE__?: boolean }
  if (on === undefined) delete w.__FF_AUTH_EXPERIENCE__
  else w.__FF_AUTH_EXPERIENCE__ = on
}

describe('LoginPage — fuzefront.auth.experience', () => {
  const setUser = vi.fn()
  beforeEach(() => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: null,
      currentUser: null,
      isAuthenticated: false,
      setUser,
      setCurrentUser: vi.fn(),
    } as any)
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(METHODS)
    vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({})
    vi.spyOn(authAPI, 'getCurrentUser').mockResolvedValue({ id: 'u1', email: 'ada@lovelace.io' } as any)
  })
  afterEach(() => {
    setFlag(undefined)
    vi.restoreAllMocks()
  })

  describe('flag OFF (default)', () => {
    it('renders no Forgot password? link', async () => {
      setLocation('/login')
      render(<LoginPage />)
      await waitFor(() => expect(authAPI.getAuthMethods).toHaveBeenCalled())
      expect(screen.queryByRole('link', { name: /forgot password/i })).toBeNull()
    })

    it('renders the CURRENT signup form: single optional name, no checklist/confirm/Turnstile', async () => {
      setLocation('/signup')
      render(<LoginPage />)
      await screen.findByLabelText(/full name/i)
      expect(document.querySelector('[data-frame="01-signup"]')).toBeNull()
      expect(document.querySelector('[data-pwreq]')).toBeNull()
      expect(document.querySelector('[data-turnstile]')).toBeNull()
      expect(screen.queryByLabelText(/confirm password/i)).toBeNull()
    })

    it('does not consult verification status after signup (straight to the app)', async () => {
      setLocation('/signup')
      const status = vi.spyOn(authAPI, 'getVerificationStatus')
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      render(<LoginPage />)
      await signUp()
      await waitFor(() => expect(authAPI.getCurrentUser).toHaveBeenCalled())
      expect(status).not.toHaveBeenCalled()
      expect(window.location.href).toBe('/dashboard')
    })
  })

  describe('flag ON', () => {
    beforeEach(() => setFlag(true))

    it('renders Forgot password? linking to /reset on sign-in', async () => {
      setLocation('/login')
      render(<LoginPage />)
      const link = await screen.findByRole('link', { name: /forgot password/i })
      expect(link).toHaveAttribute('href', '/reset')
    })

    it('routes an unverified fresh signup to /signup/verify?email=', async () => {
      setLocation('/signup')
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      vi.spyOn(authAPI, 'getVerificationStatus').mockResolvedValue({ emailVerified: false, phoneVerified: false })
      render(<LoginPage />)
      await signUp(true)
      await waitFor(() =>
        expect(window.location.href).toBe('/signup/verify?email=ada%40lovelace.io')
      )
      expect(authAPI.getVerificationStatus).toHaveBeenCalledWith('t')
    })

    it('carries a saved fuzepicker deep link through the verification detour and clears the stash', async () => {
      setLocation('/signup')
      window.sessionStorage.setItem('fuzepicker:return-path', '/fuzepicker/mentions/42')
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      vi.spyOn(authAPI, 'getVerificationStatus').mockResolvedValue({ emailVerified: false, phoneVerified: false })
      render(<LoginPage />)
      await signUp(true)
      await waitFor(() =>
        expect(window.location.href).toBe(
          '/signup/verify?email=ada%40lovelace.io&next=%2Ffuzepicker%2Fmentions%2F42'
        )
      )
      expect(window.sessionStorage.getItem('fuzepicker:return-path')).toBeNull()
    })

    it('goes to the app when the email is already verified', async () => {
      setLocation('/signup')
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      vi.spyOn(authAPI, 'getVerificationStatus').mockResolvedValue({ emailVerified: true, phoneVerified: false })
      render(<LoginPage />)
      await signUp(true)
      await waitFor(() => expect(window.location.href).toBe('/dashboard'))
    })

    it('fails open to the app when the status check errors', async () => {
      setLocation('/signup')
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      vi.spyOn(authAPI, 'getVerificationStatus').mockRejectedValue(new Error('boom'))
      render(<LoginPage />)
      await signUp(true)
      await waitFor(() => expect(window.location.href).toBe('/dashboard'))
    })

    it('skips the status call when the platform does not verify email', async () => {
      setLocation('/signup')
      vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue({ ...METHODS, verification: { email: false, sms: false } })
      const status = vi.spyOn(authAPI, 'getVerificationStatus')
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      render(<LoginPage />)
      await signUp(true)
      await waitFor(() => expect(window.location.href).toBe('/dashboard'))
      expect(status).not.toHaveBeenCalled()
    })

    describe('redesigned signup (SignUpFlow)', () => {
      const httpErr = (status: number, code?: string) =>
        Object.assign(new Error('boom'), { response: { status, data: { code } } })
      const submitBtn = () => document.querySelector('[data-action="submit"]') as HTMLButtonElement

      beforeEach(() => {
        ts.props = null
        ts.reset.mockClear()
        setLocation('/signup')
      })

      it('renders the redesigned form with the frame hooks (and none of the legacy first/last fields)', async () => {
        render(<LoginPage />)
        await screen.findByLabelText(/^work email/i)
        expect(document.querySelector('[data-frame="01-signup"]')).not.toBeNull()
        expect(document.querySelector('[data-field="full-name"]')).toHaveAttribute('autocomplete', 'name')
        expect(document.querySelector('[data-pwreq]')).not.toBeNull()
        expect(screen.queryByLabelText(/first name/i)).toBeNull()
        expect(submitBtn()).toBeDisabled()
      })

      it('renders the policy from AuthMethods.passwordPolicy (not a hard-coded copy)', async () => {
        vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue({
          ...METHODS,
          passwordPolicy: { minLength: 9, requireUpper: false, requireLower: true, requireDigit: false, requireSymbol: false },
        })
        render(<LoginPage />)
        await screen.findByText('9+ characters')
        expect(Array.from(document.querySelectorAll('[data-req]')).map(e => e.getAttribute('data-req'))).toEqual(['length', 'lower'])
      })

      it('sends the single `name` + the Turnstile token, and only renders Turnstile when the platform advertises a captcha', async () => {
        vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue({
          ...METHODS,
          verification: { email: false, sms: false },
          captcha: { provider: 'turnstile', siteKey: 'sk-test' },
        })
        const signup = vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
        render(<LoginPage />)
        await waitFor(() => expect(document.querySelector('[data-turnstile]')).not.toBeNull())
        expect(ts.props!.siteKey).toBe('sk-test')
        fireEvent.change(document.querySelector('[data-field="full-name"]')!, { target: { value: '李小龍' } })
        fireEvent.change(await screen.findByLabelText(/^work email/i), { target: { value: 'ada@lovelace.io' } })
        fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
        fireEvent.change(screen.getByLabelText(/^confirm password/i), { target: { value: STRONG } })
        expect(submitBtn()).toBeDisabled() // challenge not solved yet
        await act(async () => ts.props!.onSuccess('cf-token'))
        fireEvent.click(submitBtn())
        await waitFor(() => expect(signup).toHaveBeenCalled())
        expect(signup).toHaveBeenCalledWith({
          email: 'ada@lovelace.io',
          password: STRONG,
          name: '李小龍',
          turnstileToken: 'cf-token',
        })
      })

      it('debounced availability goes to the new /signup/email-available client method and FAILS OPEN', async () => {
        const check = vi
          .spyOn(authAPI, 'checkSignupEmailAvailable')
          .mockRejectedValue(httpErr(429, 'RATE_LIMITED'))
        vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
        render(<LoginPage />)
        fireEvent.change(await screen.findByLabelText(/^work email/i), { target: { value: 'ada@lovelace.io' } })
        await waitFor(() => expect(check).toHaveBeenCalledWith('ada@lovelace.io', expect.any(AbortSignal)), { timeout: 3000 })
        await waitFor(() => expect(document.querySelector('[data-avail-state="error"]')).not.toBeNull())
        fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
        fireEvent.change(screen.getByLabelText(/^confirm password/i), { target: { value: STRONG } })
        expect(submitBtn()).toBeEnabled() // availability failure never blocks submit
      })

      it('409 -> "sign in instead" conflict card (account-exists is the authoritative duplicate check)', async () => {
        vi.spyOn(authAPI, 'signup').mockRejectedValue(httpErr(409, 'CONFLICT'))
        render(<LoginPage />)
        await signUp(true)
        const card = await screen.findByRole('alert')
        expect(card).toHaveAttribute('data-state', 'signup-conflict')
        expect(card.querySelector('[data-nav="reset"]')).toHaveAttribute('href', '/reset')
      })

      it('503 PROVIDER_UNAVAILABLE -> service-unavailable card; retry returns to the form', async () => {
        vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue({ ...METHODS, social: ['google'] })
        vi.spyOn(authAPI, 'signup').mockRejectedValue(httpErr(503, 'PROVIDER_UNAVAILABLE'))
        render(<LoginPage />)
        await signUp(true)
        await waitFor(() => expect(document.querySelector('[data-state="signup-service-unavailable"]')).not.toBeNull())
        expect(document.querySelector('[data-action="social-google"]')).not.toBeNull()
        fireEvent.click(document.querySelector('[data-action="retry"]')!)
        expect(document.querySelector('[data-form="signup"]')).not.toBeNull()
      })

      it('weak password rejected by the server -> post-submit alert', async () => {
        vi.spyOn(authAPI, 'signup').mockRejectedValue(httpErr(400, 'MALFORMED'))
        render(<LoginPage />)
        await signUp(true)
        expect((await screen.findByRole('alert')).getAttribute('data-state')).toBe('signup-pw-weak-submit')
      })

      it('"Sign in" in the signup experience switches to sign-in (no page reload)', async () => {
        render(<LoginPage />)
        fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }))
        expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument()
      })
    })
  })
})

const STRONG = 'Rev0lution-99$x'

/** Fill + submit the signup form. `experience` = the redesigned form (adds confirm; "Work email"). */
async function signUp(experience = false) {
  fireEvent.change(await screen.findByLabelText(experience ? /^work email/i : /^email/i), {
    target: { value: 'ada@lovelace.io' },
  })
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
  if (experience) {
    fireEvent.change(screen.getByLabelText(/^confirm password/i), { target: { value: STRONG } })
  }
  const submit = await screen.findByRole('button', { name: /create account/i })
  // The new form keeps submit disabled until the checklist/confirm (and captcha) pass.
  await waitFor(() => expect(submit).toBeEnabled())
  fireEvent.click(submit)
}
