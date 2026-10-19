/**
 * LoginPage.auth-experience.test.tsx (FFRNT-360)
 *
 * With `fuzefront.auth.experience` ON: sign-in gets a "Forgot password?" link to
 * /reset, and a fresh signup with an unverified email is routed to
 * /signup/verify. With it OFF (default) neither changes today's behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { AuthMethods } from '@fuzefront/security-client'

vi.mock('../assets/FuzeFrontLogo.svg', () => ({ default: 'mock-logo.png' }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}))
vi.mock('../lib/shared', () => ({ useCurrentUser: vi.fn() }))

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
      await signUp()
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
      await signUp()
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
      await signUp()
      await waitFor(() => expect(window.location.href).toBe('/dashboard'))
    })

    it('fails open to the app when the status check errors', async () => {
      setLocation('/signup')
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      vi.spyOn(authAPI, 'getVerificationStatus').mockRejectedValue(new Error('boom'))
      render(<LoginPage />)
      await signUp()
      await waitFor(() => expect(window.location.href).toBe('/dashboard'))
    })

    it('skips the status call when the platform does not verify email', async () => {
      setLocation('/signup')
      vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue({ ...METHODS, verification: { email: false, sms: false } })
      const status = vi.spyOn(authAPI, 'getVerificationStatus')
      vi.spyOn(authAPI, 'signup').mockResolvedValue({ token: 't', sessionId: 's', user: { id: 'u1' } } as any)
      render(<LoginPage />)
      await signUp()
      await waitFor(() => expect(window.location.href).toBe('/dashboard'))
      expect(status).not.toHaveBeenCalled()
    })
  })
})

async function signUp() {
  fireEvent.change(await screen.findByLabelText(/^email/i), { target: { value: 'ada@lovelace.io' } })
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Rev0lution-99$x' } })
  fireEvent.click(screen.getByRole('button', { name: /create account/i }))
}
