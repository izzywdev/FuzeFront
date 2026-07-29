/**
 * LoginPage.auth-panel-adapter.test.tsx
 *
 * Covers the LoginPage <-> @fuzefront/auth-ui AuthPanel adapter boundary
 * introduced by the AuthPanel refactor, which isn't exercised by the other
 * LoginPage.*.test.tsx files (those cover mode-detection, the Google/
 * credentials sign-in path, and the login error taxonomy — all unchanged by
 * this refactor):
 *   1. Signup submits through the AuthTransport and lands on /dashboard.
 *   2. A failed signup surfaces the same friendly error wording the old
 *      inline catch block produced (mapAuthError in LoginPage.tsx), via
 *      AuthPanel's own alert — not the raw axios message.
 *   3. A social-callback result that resolves to an mfa_required challenge
 *      shows the page-level notice (separate from AuthPanel's own
 *      form-submit notice, since AuthPanel has no prop to surface an
 *      externally-sourced result).
 *
 * NOTE: the pre-refactor LoginPage also had a confirm-password field, a
 * password-policy checklist gating submit, and an inline email-availability
 * check on signup. @fuzefront/auth-ui's AuthPanel (v0.1.0) does not yet
 * implement any of those, so they are gone from this page — not
 * reintroduced as one-off markup here, which would refork logic AuthPanel is
 * meant to own. Tracked as a fast-follow against @fuzefront/auth-ui.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { AuthMethods } from '@fuzefront/security-client'

vi.mock('../assets/FuzeFrontLogo.svg', () => ({ default: 'mock-logo.png' }))

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}))

vi.mock('../lib/shared', () => ({
  useCurrentUser: vi.fn(),
}))

import LoginPage from '../pages/LoginPage'
import * as sharedMock from '../lib/shared'
import { authAPI } from '../services/api'

function makeUserCtx(overrides: Partial<ReturnType<typeof sharedMock.useCurrentUser>> = {}) {
  return {
    user: null,
    currentUser: null,
    isAuthenticated: false,
    setUser: vi.fn(),
    setCurrentUser: vi.fn(),
    ...overrides,
  }
}

const PASSWORD_ONLY: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

/** Replace window.location wholesale so `pathname` is settled before render
 * (LoginPage derives its initial mode from it in a useState initializer). */
function setLocation(pathname: string) {
  const stub = {
    search: '',
    pathname,
    href: `https://app.fuzefront.com${pathname}`,
    origin: 'https://app.fuzefront.com',
  }
  Object.defineProperty(global, 'location', { value: stub, writable: true, configurable: true })
  return stub
}

describe('LoginPage <-> AuthPanel adapter', () => {
  let locationStub: ReturnType<typeof setLocation>

  beforeEach(() => {
    vi.clearAllMocks()
    locationStub = setLocation('/signup')

    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(makeUserCtx())

    vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({})
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(PASSWORD_ONLY)
    vi.spyOn(authAPI, 'signup')
    vi.spyOn(authAPI, 'getCurrentUser')

    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits signup through the transport and lands on /dashboard', async () => {
    const mockUser = {
      id: 'u1',
      email: 'ada@ex.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: ['user'],
    }
    const setUser = vi.fn()
    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(makeUserCtx({ setUser }))
    vi.mocked(authAPI.signup).mockResolvedValue({ token: 'tok-1', sessionId: 'sess-1', user: mockUser })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser as any)

    render(<LoginPage />)
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Lovelace' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'S3cret!!!!' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    })

    expect(authAPI.signup).toHaveBeenCalledWith({
      email: 'ada@ex.com',
      password: 'S3cret!!!!',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(mockUser))
    expect(locationStub.href).toBe('/dashboard')
  })

  it('shows a friendly error (not the raw axios message) when signup is rejected with a provider outage', async () => {
    const outageErr: any = new Error('Request failed with status code 503')
    outageErr.response = { status: 503, data: { error: 'unavailable', code: 'PROVIDER_UNAVAILABLE' } }
    vi.mocked(authAPI.signup).mockRejectedValue(outageErr)

    render(<LoginPage />)
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'S3cret!!!!' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    })

    await waitFor(() =>
      expect(screen.getByText(/sign-in service is temporarily unavailable/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/request failed with status code/i)).not.toBeInTheDocument()
  })

  it('shows the page-level notice when the social-callback exchange resolves to an mfa_required challenge', async () => {
    locationStub = setLocation('/login')
    vi.mocked(authAPI.handleAuthCallback).mockResolvedValue({
      result: {
        status: 'mfa_required',
        challengeId: 'chal-1',
        factors: [{ factorId: 'f1', type: 'totp' }],
      },
    })

    render(<LoginPage />)

    await waitFor(() =>
      expect(screen.getByText(/additional verification is required/i)).toBeInTheDocument()
    )
    // Not the credentials-form submit path — getCurrentUser must not be called.
    expect(authAPI.getCurrentUser).not.toHaveBeenCalled()
  })
})
