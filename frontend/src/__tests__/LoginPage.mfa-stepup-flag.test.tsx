/**
 * LoginPage MFA step-up gating (FFRNT-141 / FFRNT-362).
 *
 * A server `mfa_required` is ALWAYS answerable: with every flag OFF the desktop step-up
 * renders (a challenge must never dead-end). The flags only pick the presentation.
 * Both release flags default OFF. Pre-auth, so they resolve through the pre-auth
 * override (`window.__FF_FLAGS__`, platform/preAuthFlags.ts). Both states are
 * exercised (feature-flags skill: test BOTH states):
 *   - OFF: the desktop step-up (MfaStepUpFlow) renders and works.
 *   - mfa-management ON: the desktop step-up renders.
 *   - mfa-stepup-mobile ON + compact viewport: the mobile step-up renders.
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

import LoginPage from '../pages/LoginPage'
import { resolveStepUpVariant } from '../components/account-security/LoginStepUp'
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

function setCompact(compact: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: compact,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function setFlags(flags: Record<string, boolean> | undefined) {
  const w = window as unknown as { __FF_FLAGS__?: Record<string, boolean> }
  w.__FF_FLAGS__ = flags
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
  setCompact(false)
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

  it('resolveStepUpVariant is NEVER null: desktop by default, mobile only with its flag AND a compact viewport', () => {
    setFlags(undefined)
    expect(resolveStepUpVariant(false)).toBe('desktop')
    expect(resolveStepUpVariant(true)).toBe('desktop')
    setFlags({ [MGMT]: true })
    expect(resolveStepUpVariant(true)).toBe('desktop')
    setFlags({ [MOBILE]: true })
    expect(resolveStepUpVariant(false)).toBe('desktop')
    expect(resolveStepUpVariant(true)).toBe('mobile')
  })
})

describe('LoginPage — MFA step-up', () => {
  it('EVERY flag OFF: a server mfa_required still renders a WORKING step-up (never a dead-end notice)', async () => {
    setFlags(undefined)
    const persist = vi.spyOn(authAPI, 'completeMfaSession').mockImplementation(() => {})
    vi.spyOn(authAPI, 'getCurrentUser').mockRejectedValue(new Error('stop after persist'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ token: 'tok_off', sessionId: 's' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    )
    const user = userEvent.setup()
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-component="mfa-challenge"]')).toBeTruthy())
    expect(screen.queryByText(/additional verification is required/i)).toBeNull()
    expect(document.querySelector('[data-panel="choose-factor"]')).toBeNull()
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('123456')
    await user.click(document.querySelector('[data-action="verify-mfa"]')!)
    await waitFor(() => expect(persist).toHaveBeenCalledWith({ token: 'tok_off', sessionId: 's' }))
    vi.unstubAllGlobals()
  })

  it('flag OFF + compact viewport: the desktop step-up is HOSTED flush inside the login card (no nested card chrome)', async () => {
    setCompact(true)
    setFlags(undefined)
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-component="mfa-challenge"]')).toBeTruthy())
    expect(document.querySelector('[data-frame="05-step-up-challenge"]')).toBeTruthy()
    const card = document.querySelector('[data-component="mfa-challenge"]') as HTMLElement
    // A non-flush SeamCard is `overflow: hidden` with padding + border; flush has none.
    expect(card.style.overflow).not.toBe('hidden')
    expect(card.style.padding).toBe('')
  })

  it('mfa-management ON: the desktop step-up renders for the challenge', async () => {
    setFlags({ [MGMT]: true })
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-component="mfa-challenge"]')).toBeTruthy())
    expect(document.querySelector('[data-frame="05-step-up-challenge"]')).toBeTruthy()
  })

  it('mfa-stepup-mobile ON on a wide viewport still renders the desktop step-up', async () => {
    setFlags({ [MOBILE]: true })
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-component="mfa-challenge"]')).toBeTruthy())
    expect(document.querySelector('[data-panel="choose-factor"]')).toBeNull()
  })

  it('mfa-stepup-mobile ON + compact viewport: the mobile step-up renders (choose a factor)', async () => {
    setCompact(true)
    setFlags({ [MOBILE]: true })
    render(<LoginPage />)
    await waitFor(() => expect(document.querySelector('[data-panel="choose-factor"][data-state="loaded"]')).toBeTruthy())
    expect(document.querySelector('[data-frame="01-choose-factor"]')).toBeTruthy()
  })

  it('a verified step-up persists the minted session through authAPI', async () => {
    setCompact(true)
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

  describe.each([
    ['flags OFF (desktop)', false],
    ['mfa-stepup-mobile ON + compact (mobile)', true],
  ])('recovery-code redemption — %s', (_label, mobile) => {
    const arrange = (recoveryAvailable: boolean | undefined) => {
      setCompact(mobile)
      setFlags(mobile ? { [MOBILE]: true } : undefined)
      vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({
        result: { ...CHALLENGE, ...(recoveryAvailable === undefined ? {} : { recoveryAvailable }) },
      } as never)
    }
    const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => expect(document.querySelector('[data-component="mfa-challenge"], [data-panel="choose-factor"]')).toBeTruthy())
      const different = screen.queryByRole('button', { name: /different method/i })
      if (different) await user.click(different)
    }

    it('recoveryAvailable missing/false: no recovery option (fail-closed)', async () => {
      for (const flag of [undefined, false]) {
        arrange(flag)
        const user = userEvent.setup()
        const { unmount } = render(<LoginPage />)
        await openPicker(user)
        await waitFor(() => expect(document.querySelector('[data-component="factor-picker"]')).toBeTruthy())
        expect(document.querySelector('[data-factor="recovery"]')).toBeNull()
        unmount()
      }
    })

    it('recoveryAvailable true: redeems { challengeId, recoveryCode } and persists the session', async () => {
      arrange(true)
      const persist = vi.spyOn(authAPI, 'completeMfaSession').mockImplementation(() => {})
      vi.spyOn(authAPI, 'getCurrentUser').mockRejectedValue(new Error('stop after persist'))
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ token: 'tok_r', sessionId: 'sess_r' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      vi.stubGlobal('fetch', fetchMock)
      const user = userEvent.setup()
      render(<LoginPage />)
      await openPicker(user)
      await user.click(await waitFor(() => document.querySelector('[data-factor="recovery"]')! as Element))
      await user.type(document.querySelector('[data-field="recovery-code"]')!, 'a1b2c3d4e5')
      await user.click(document.querySelector('[data-action="verify-mfa"]')!)
      await waitFor(() => expect(persist).toHaveBeenCalledWith({ token: 'tok_r', sessionId: 'sess_r' }))
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('/api/v1/security/mfa/verify')
      expect(JSON.parse(String(init.body))).toEqual({ challengeId: 'chl_1', recoveryCode: 'a1b2c3d4e5' })
      vi.unstubAllGlobals()
    })
  })
})
