/**
 * LoginPage.submit-resilience.test.tsx
 *
 * Prod bug: a slow `/session` request (intermittent 16-30s auth-chain hop)
 * left the credentials submit button stuck on "Signing in…" with no
 * feedback, sometimes 401-ing after ~19s with the user never told why.
 *
 * These tests cover the resilience fix in LoginPage.handleCredentialsSubmit:
 *   1. A timed-out / aborted login() rejection surfaces a distinct, clear
 *      "taking longer than expected" message (not the generic network string)
 *      and un-sticks the submit button (pending resets, Sign In re-enabled).
 *   2. A 401 rejection surfaces a message that doesn't wrongly accuse the
 *      user of a typo (401 here is ambiguous: bad creds OR a slow-auth
 *      abort) and also un-sticks the button.
 *   3. `pending` always resets via the `finally` — verified by both cases
 *      above returning to the enabled, unstuck state.
 *
 * The dedicated shorter timeout applied to the login() call itself
 * (LOGIN_TIMEOUT_MS in services/api.ts) is exercised implicitly: this test
 * mocks authAPI.login directly, so it asserts on the UI's handling of the
 * rejection shape axios produces for a timeout/abort, not the timeout wiring
 * itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { AuthMethods } from '@fuzeone/security-client'

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

const PASSWORD_ONLY_METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

describe('LoginPage — credentials submit resilience (fail-fast + clear errors)', () => {
  let locationStub: { search: string; pathname: string; href: string; origin: string }

  beforeEach(() => {
    vi.clearAllMocks()

    locationStub = { search: '', pathname: '/', href: 'http://localhost/', origin: 'http://localhost' }
    Object.defineProperty(global, 'location', {
      value: locationStub,
      writable: true,
      configurable: true,
    })

    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(makeUserCtx())

    vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({})
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(PASSWORD_ONLY_METHODS)
    vi.spyOn(authAPI, 'login')
    vi.spyOn(authAPI, 'getCurrentUser')

    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'group').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function fillAndSubmit() {
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'someone@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    })
  }

  it('shows a distinct "taking longer than expected" message on a timed-out login and un-sticks the button', async () => {
    const timeoutErr: any = new Error('timeout of 15000ms exceeded')
    timeoutErr.code = 'ECONNABORTED'
    vi.mocked(authAPI.login).mockRejectedValue(timeoutErr)

    render(<LoginPage />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument()
    })
    // Never the generic network-failure string for a timeout.
    expect(screen.queryByText(/network connection failed/i)).not.toBeInTheDocument()

    // Button un-stuck: back to "Sign In", enabled.
    const signIn = screen.getByRole('button', { name: /^sign in$/i })
    expect(signIn).not.toBeDisabled()
    expect(screen.queryByText(/^signing in…$/i)).not.toBeInTheDocument()
  })

  // The Security API used to answer 401 for BOTH a rejected credential and a
  // provider outage, so this message had to hedge across the two ("wrong
  // password, OR the service is down") — telling users during an incident that
  // their password might be at fault. The API now separates them (503
  // PROVIDER_UNAVAILABLE vs 401), so each case says one true thing.

  it('shows a plain rejected-credentials message on 401 and un-sticks the button', async () => {
    const unauthorizedErr: any = new Error('Request failed with status code 401')
    unauthorizedErr.response = { status: 401, data: { error: 'Unauthorized' } }
    vi.mocked(authAPI.login).mockRejectedValue(unauthorizedErr)

    render(<LoginPage />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(
        screen.getByText(/incorrect email or password/i)
      ).toBeInTheDocument()
    })
    // No longer hedged against an outage — 401 now means only one thing.
    expect(
      screen.queryByText(/temporarily unavailable/i)
    ).not.toBeInTheDocument()

    const signIn = screen.getByRole('button', { name: /^sign in$/i })
    expect(signIn).not.toBeDisabled()
    expect(screen.queryByText(/^signing in…$/i)).not.toBeInTheDocument()
  })

  it('never blames the user’s credentials on a 503 provider outage', async () => {
    const outageErr: any = new Error('Request failed with status code 503')
    outageErr.response = {
      status: 503,
      data: { error: 'Authentication unavailable', code: 'PROVIDER_UNAVAILABLE' },
    }
    vi.mocked(authAPI.login).mockRejectedValue(outageErr)

    render(<LoginPage />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(
        screen.getByText(/sign-in service is temporarily unavailable/i)
      ).toBeInTheDocument()
    })
    // The whole point: an incident must not read as a credentials problem.
    expect(
      screen.queryByText(/incorrect email or password/i)
    ).not.toBeInTheDocument()

    const signIn = screen.getByRole('button', { name: /^sign in$/i })
    expect(signIn).not.toBeDisabled()
    expect(screen.queryByText(/^signing in…$/i)).not.toBeInTheDocument()
  })
})
