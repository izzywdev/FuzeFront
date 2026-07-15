/**
 * LoginPage.google-signin.test.tsx
 *
 * Component-level unit tests for the social ("Sign in with Google") flow on the
 * LoginPage, plus the credentials sign-in path.
 *
 * Architecture reminder (provider-neutral):
 *   The browser only ever talks to FuzeFront's OWN same-origin Security API
 *   (/api/v1/security/*). No identity provider is named on the consumer surface —
 *   the federation/MFA engine behind it is a swappable server-side adapter.
 *
 *   User → "Sign in with Google" → authAPI.startSocialLogin('google')
 *        → 302 to the same-host social authorize path → provider consent
 *        → app is returned to with ?code=<opaque>
 *        → authAPI.handleAuthCallback() exchanges the code for a SessionResult
 *        → completeSession() hydrates the user and lands on /dashboard.
 *
 * The internals of handleAuthCallback (?code= exchange, error param, empty URL,
 * ?token= security boundary) are covered by handleAuthCallback.test.ts.
 *
 * What IS tested here:
 *   1. Google button visibility driven by the neutral `social` capability list
 *   2. Clicking the Google button calls authAPI.startSocialLogin('google')
 *   3. Error from handleAuthCallback is surfaced on the page
 *   4. A successful callback SessionResult triggers getCurrentUser + redirect
 *   5. Credentials submit calls authAPI.login (single, provider-neutral path)
 *   6. The sign-up affordance toggles the in-page sign-up form (no external
 *      enrollment redirect)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { AuthMethods } from '@fuzefront/security-client'

// ── Hoisted mocks (processed before imports) ──────────────────────────────

// PNG asset — jsdom cannot load real images; return a stable string.
vi.mock('../assets/FrontFuseLogo.png', () => ({ default: 'mock-logo.png' }))

// LanguageContext — LoginPage calls useLanguage(). Echo translation keys so
// t('signUp') returns 'signUp', making button text predictable in assertions.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}))

// lib/shared — LoginPage calls useCurrentUser(). Provide a vi.fn() so each
// test can configure the return value via vi.mocked().mockReturnValue().
vi.mock('../lib/shared', () => ({
  useCurrentUser: vi.fn(),
}))

// ── Real imports (resolved after hoisted mocks) ────────────────────────────

import LoginPage from '../pages/LoginPage'
import * as sharedMock from '../lib/shared'
import { authAPI } from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal useCurrentUser return value — override setUser per-test as needed. */
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

/** Neutral capability descriptor — password only, no social provider. */
const PASSWORD_ONLY_METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

/** Neutral capability descriptor — password + Google social. */
const SOCIAL_METHODS: AuthMethods = {
  password: true,
  social: ['google'],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('LoginPage — social / Google Sign-In UI', () => {
  /**
   * Mutable location stub — written by the component when it does
   * `window.location.href = '/dashboard'`. Reset in beforeEach.
   */
  let locationStub: {
    search: string
    pathname: string
    href: string
    origin: string
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Install a mutable window.location so href assignments are observable.
    locationStub = {
      search: '',
      pathname: '/',
      href: 'http://localhost/',
      origin: 'http://localhost',
    }
    Object.defineProperty(global, 'location', {
      value: locationStub,
      writable: true,
      configurable: true,
    })

    // Default useCurrentUser
    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(makeUserCtx())

    // Default authAPI spies — individual tests override per-case.
    vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({})
    vi.spyOn(authAPI, 'getAuthMethods')
    vi.spyOn(authAPI, 'startSocialLogin').mockResolvedValue(undefined)
    vi.spyOn(authAPI, 'login')
    vi.spyOn(authAPI, 'signup')
    vi.spyOn(authAPI, 'getCurrentUser')

    // Suppress api.ts / component console noise so test output stays clean.
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'group').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1: No Google button, credentials form fallback when no social provider ─

  it('renders the credentials form but no Google button when no social provider is advertised', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(PASSWORD_ONLY_METHODS)

    render(<LoginPage />)

    // Wait for auth methods to have loaded (the credentials form is the
    // sentinel — it only renders once authMethods state is set).
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()

    expect(screen.queryByText(/sign in with authentik/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  // ── 1b: Regression — auth methods fetched ONCE, not in a render loop ─────

  it('fetches auth methods exactly once (no re-render loop)', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(SOCIAL_METHODS)

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })
    // Give any runaway effect a chance to re-fire before asserting.
    await new Promise(r => setTimeout(r, 100))

    // A single mount must produce a single capability fetch + one callback probe.
    // Before the useCurrentUser stabilization, an unstable setUser ref re-fired
    // the page-load effect every render and flooded this endpoint (~2-3 req/s).
    expect(authAPI.getAuthMethods).toHaveBeenCalledTimes(1)
    expect(authAPI.handleAuthCallback).toHaveBeenCalledTimes(1)
  })

  // ── 2: Credentials form AND Google button when social is advertised ───────

  it('renders the credentials form AND "Sign in with Google" when the social provider is advertised', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(SOCIAL_METHODS)

    render(<LoginPage />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /sign in with google/i })
      ).toBeInTheDocument()
    })
    // Default UI components for credentials — always present when password is enabled.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    // No provider is named on the consumer surface.
    expect(screen.queryByText(/sign in with authentik/i)).not.toBeInTheDocument()
  })

  // ── 2a: Credentials submit uses the single provider-neutral login path ────

  it('submitting the form calls the provider-neutral authAPI.login and lands on /dashboard', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'someone@example.com',
      firstName: 'Some',
      lastName: 'One',
      roles: ['user'],
    }
    const setUser = vi.fn()
    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUserCtx({ setUser })
    )
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(SOCIAL_METHODS)
    // Password login returns an authenticated SessionResult; completeSession then
    // hydrates the user via getCurrentUser.
    vi.mocked(authAPI.login).mockResolvedValue({
      status: 'authenticated',
      token: 'jwt-1',
      sessionId: 'sess-1',
      user: mockUser,
    })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser as any)

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'someone@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter22' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    })

    expect(authAPI.login).toHaveBeenCalledWith({
      email: 'someone@example.com',
      password: 'hunter22',
    })
    await waitFor(() => {
      expect(setUser).toHaveBeenCalledWith(mockUser)
    })
    expect(locationStub.href).toBe('/dashboard')
  })

  // ── 2b: Clicking the Google button starts the server-brokered social flow ─

  it('clicking "Sign in with Google" calls authAPI.startSocialLogin("google")', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(SOCIAL_METHODS)

    render(<LoginPage />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /sign in with google/i })
      ).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    })

    expect(authAPI.startSocialLogin).toHaveBeenCalledWith('google')
  })

  // ── 4: Error from handleAuthCallback surfaces on the page ───────────────

  it('shows "Authentication Error" on page when handleAuthCallback returns an error', async () => {
    // Simulates landing on the login page after a social-provider error
    // (?error=...&message=access_denied in the URL). handleAuthCallback reads
    // those params and returns { error: '...' }.
    vi.mocked(authAPI.handleAuthCallback).mockResolvedValue({
      error: 'access_denied',
    })
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(PASSWORD_ONLY_METHODS)

    render(<LoginPage />)

    // The component sets error state → renders the error block.
    await waitFor(() => {
      expect(screen.getByText(/authentication error/i)).toBeInTheDocument()
    })
    // The error detail from the callback is shown below the header.
    expect(screen.getByText(/access_denied/i)).toBeInTheDocument()
  })

  // ── 5: Successful callback SessionResult → getCurrentUser → /dashboard ────

  it('completes login and navigates to /dashboard when handleAuthCallback returns an authenticated session', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@google.com',
      firstName: 'Test',
      lastName: 'User',
      roles: ['user'],
    }
    const setUser = vi.fn()

    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(
      makeUserCtx({ setUser })
    )

    // handleAuthCallback returns an authenticated SessionResult (from a ?code=
    // exchange that already happened internally — the real function is tested in
    // handleAuthCallback.test.ts).
    vi.mocked(authAPI.handleAuthCallback).mockResolvedValue({
      result: {
        status: 'authenticated',
        token: 'jwt-test-token',
        sessionId: 'sess-1',
        user: mockUser,
      },
    })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser as any)

    render(<LoginPage />)

    // Component calls getCurrentUser after receiving the authenticated session.
    await waitFor(() => {
      expect(authAPI.getCurrentUser).toHaveBeenCalledTimes(1)
    })

    // setUser is called with the fetched user.
    await waitFor(() => {
      expect(setUser).toHaveBeenCalledWith(mockUser)
    })

    // Navigation happens via window.location.href = '/dashboard'.
    expect(locationStub.href).toBe('/dashboard')
  })

  // ── 6: Sign-Up affordance toggles the in-page enrollment form ────────────

  it('the sign-up button toggles the in-page sign-up form (no external enrollment redirect)', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(SOCIAL_METHODS)

    render(<LoginPage />)

    // Wait for auth methods so the page is fully settled.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /sign in with google/i })
      ).toBeInTheDocument()
    })

    // The sign-up button text comes from t('signUp'). With our mocked useLanguage
    // returning the translation key directly, the button text is literally 'signUp'.
    const signUpButton = screen.getByRole('button', { name: 'signUp' })
    expect(signUpButton).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(signUpButton)
    })

    // Toggling to sign-up mode reveals the enrollment fields and relabels the
    // primary action — all on the same page, brokered by the Security API.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument()
  })

  // ── 7: Per-action pending labels — only the clicked button shows progress ─

  it('clicking Google shows "Redirecting" ONLY on the Google button; the others just disable', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(SOCIAL_METHODS)
    // Keep the redirect "in flight" — location.href assignment doesn't unload
    // jsdom, so the component stays mounted with pending === 'google'.
    vi.mocked(authAPI.startSocialLogin).mockImplementation(() => new Promise(() => {}))

    render(<LoginPage />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /sign in with google/i })
      ).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    })

    // Google button reflects ITS pending state…
    expect(screen.getByText(/redirecting to google/i)).toBeInTheDocument()
    // …while the credentials submit keeps its label (disabled, not relabeled)…
    const signIn = screen.getByRole('button', { name: /^sign in$/i })
    expect(signIn).toBeDisabled()
    // …and the sign-up button keeps its label (disabled, not "Redirecting…").
    const signUp = screen.getByRole('button', { name: 'signUp' })
    expect(signUp).toBeDisabled()
  })
})
