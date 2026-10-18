/**
 * LoginPage MFA step-up gating (FFRNT-141 / FFRNT-362).
 *
 * Both release flags default OFF. Pre-auth, so they resolve through the pre-auth
 * override (`window.__FF_FLAGS__`, platform/preAuthFlags.ts). Both states are
 * exercised (feature-flags skill: test BOTH states):
 *   - OFF: an `mfa_required` result keeps today's behaviour — an info notice, no
 *     step-up UI, nothing fetched.
 *   - mfa-management ON: the desktop step-up (MfaStepUpFlow) renders.
 *   - mfa-stepup-mobile ON: the mobile step-up (MfaStepUpMobileFlow) renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthMethods } from '@fuzefront/security-client'

vi.mock('../assets/FuzeFrontLogo.svg', () => ({ default: 'mock-logo.png' }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}))
vi.mock('../lib/shared', () => ({ useCurrentUser: vi.fn() }))

import LoginPage, { resolveStepUpVariant } from '../pages/LoginPage'
import * as sharedMock from '../lib/shared'
import { authAPI } from '../services/api'
import { isPreAuthFlagEnabled, preAuthFlagEnvName } from '../platform/preAuthFlags'

const MGMT = 'fuzefront.security.mfa-management'
const MOBILE = 'fuzefront.security.mfa-stepup-mobile'

const PASSWORD_ONLY: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

const CHALLENGE = {
  status: 'mfa_required' as const,
  challengeId: 'chl_1',
  factors: [
    { factorId: 'fct_totp_1', type: 'totp' as const },
    { factorId: 'fct_sms_1', type: 'sms' as const },
  ],
}

function setFlags(flags: Record<string, boolean> | undefined) {
  ;(window as unknown as { __FF_FLAGS__?: Record<string, boolean> }).__FF_FLAGS__ = flags
}

function setLocation(pathname: string) {
  Object.defineProperty(global, 'location', {
    value: { search: '', pathname, href: `https://app.fuzefront.com${pathname}`, origin: 'https://app.fuzefront.com', assign: vi.fn() },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setLocation('/login')
  ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({
    user: null,
    currentUser: null,
    isAuthenticated: false,
    setUser: vi.fn(),
    setCurrentUser: vi.fn(),
  })
  vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(PASSWORD_ONLY)
  // A social callback that resolves to an MFA challenge.
  vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({ result: CHALLENGE } as never)
})

afterEach(() => {
  setFlags(undefined)
  vi.restoreAllMocks()
})

describe('pre-auth flag resolution', () => {
  it('maps a flag key to its VITE_FF_ name', () => {
    expect(preAuthFlagEnvName(MGMT)).toBe('VITE_FF_SECURITY_MFA_MANAGEMENT')
    expect(preAuthFlagEnvName('fuzefront.account-security.password-reset')).toBe(
      'VITE_FF_ACCOUNT_SECURITY_PASSWORD_RESET'
    )
  })

  it('defaults OFF, and the runtime override wins', () => {
    setFlags(undefined)
    expect(isPreAuthFlagEnabled(MGMT)).toBe(false)
    setFlags({ [MGMT]: true })
    expect(isPreAuthFlagEnabled(MGMT)).toBe(true)
    setFlags({ [MGMT]: false })
    expect(isPreAuthFlagEnabled(MGMT)).toBe(false)
  })

  it('resolveStepUpVariant: OFF → null; mgmt → desktop; mobile → mobile; both → by viewport', () => {
    setFlags(undefined)
    expect(resolveStepUpVariant(false)).toBeNull()
    setFlags({ [MGMT]: true })
    expect(resolveStepUpVariant(true)).toBe('desktop')
    setFlags({ [MOBILE]: true })
    expect(resolveStepUpVariant(false)).toBe('mobile')
    setFlags({ [MGMT]: true, [MOBILE]: true })
    expect(resolveStepUpVariant(true)).toBe('mobile')
    expect(resolveStepUpVariant(false)).toBe('desktop')
  })
})

describe('LoginPage — MFA step-up', () => {
  it('flags OFF (default): unchanged — the info notice shows and NO step-up UI renders', async () => {
    setFlags(undefined)
    render(<LoginPage />)
    await waitFor(() => expect(screen.getByText(/additional verification is required/i)).toBeInTheDocument())
    expect(document.querySelector('[data-component="mfa-challenge"]')).toBeNull()
    expect(document.querySelector('[data-panel="choose-factor"]')).toBeNull()
  })

  it('mfa-management ON: the desktop step-up renders for the challenge', async () => {
    setFlags({ [MGMT]: true })
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-component="mfa-challenge"]')).toBeTruthy())
    expect(document.querySelector('[data-frame="05-step-up-challenge"]')).toBeTruthy()
  })

  it('mfa-stepup-mobile ON: the mobile step-up renders (choose a factor)', async () => {
    setFlags({ [MOBILE]: true })
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-panel="choose-factor"][data-state="loaded"]')).toBeTruthy())
    expect(document.querySelector('[data-frame="01-choose-factor"]')).toBeTruthy()
  })

  it('a verified step-up persists the minted session through authAPI', async () => {
    setFlags({ [MOBILE]: true })
    const persist = vi.spyOn(authAPI, 'completeMfaSession').mockImplementation(() => {})
    vi.spyOn(authAPI, 'getCurrentUser').mockRejectedValue(new Error('stop after persist'))
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'tok_1', sessionId: 'sess_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-factor="totp"][data-action="challenge"]')).toBeTruthy())
    await user.click(document.querySelector('[data-factor="totp"][data-action="challenge"]')!)
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('123456')
    await user.click(document.querySelector('[data-action="verify-mfa"]')!)
    await waitFor(() => expect(persist).toHaveBeenCalledWith({ token: 'tok_1', sessionId: 'sess_1' }))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/security/mfa/verify')
    expect(JSON.parse(String(init.body))).toEqual({ challengeId: 'chl_1', factorId: 'fct_totp_1', code: '123456' })
    vi.unstubAllGlobals()
  })
})
