/**
 * LoginPage.google-signin.test.tsx
 *
 * Component-level unit tests for the Google Sign-In flow on the LoginPage.
 *
 * Architecture:
 *   User → "Sign in with Google" button → authAPI.startSocialLogin('google')
 *        → backend /api/v1/security/social/google/start (302 redirect)
 *        → provider consent → callback → backend mints exchange code
 *        → redirect to frontend with ?code=<opaque>
 *        → authAPI.handleAuthCallback() reads ?code= and POSTs to
 *          /api/v1/security/session/exchange
 *        → backend returns SessionResult → frontend stores token + navigates
 *
 * What is NOT tested here (covered by handleOIDCCallback.test.ts):
 *   - The internals of authAPI.handleAuthCallback (?code= exchange, error
 *     param handling, empty URL, ?token= security boundary).
 *
 * What IS tested here:
 *   1. Google button visibility based on social capability (social: ['google'])
 *   2. Clicking Google button calls authAPI.startSocialLogin('google')
 *   3. Error from handleAuthCallback is surfaced on the page
 *   4. Successful result from handleAuthCallback triggers getCurrentUser + redirect
 *   5. Credentials form submit calls authAPI.login()
 *   6. Sign-up mode toggle: clicking the toggle button switches to signup form
 *   7. Per-action pending labels — only the clicked button shows progress
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { AuthMethods } from '../services/api'

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

/** Minimal AuthMethods shape with only password (no social). */
const LOCAL_ONLY_METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

/** Minimal AuthMethods shape with Google social login enabled. */
const OIDC_METHODS: AuthMethods = {
  password: true,
  social: ['google'],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('LoginPage — Google Sign-In UI', () => {
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

  // ── 1: No Google button, local-auth form fallback when social=[]

  it('renders the credentials form but no Google button when social capability is empty', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(LOCAL_ONLY_METHODS)

    render(<LoginPage />)

    // Wait for auth methods to have loaded (the credentials form is the
    // sentinel — it only renders once authMethods state is set).
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()

    expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument()
  })

  // ── 1b: Regression — auth methods fetched ONCE, not in a render loop ─────

  it('fetches auth methods exactly once (no re-render loop)', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })
    // Give any runaway effect a chance to re-fire before asserting.
    await new Promise(r => setTimeout(r, 100))

    // A single mount must produce a single /api/auth/method fetch.
    expect(authAPI.getAuthMethods).toHaveBeenCalledTimes(1)
    expect(authAPI.handleAuthCallback).toHaveBeenCalledTimes(1)
  })

  // ── 2: Credentials form + Google button when social=['google']

  it('renders the credentials form AND "Sign in with Google" button when social includes google', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)

    render(<LoginPage />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /sign in with google/i })
      ).toBeInTheDocument()
    })
    // Default UI components for credentials — always present.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  // ── 2a: Form submit calls authAPI.login() with provided credentials

  it('submitting the credentials form calls authAPI.login()', async () => {
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
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)
    vi.mocked(authAPI.login).mockResolvedValue({
      status: 'authenticated',
      token: 'jwt-token',
      sessionId: 'sess-1',
      user: mockUser,
    } as any)
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser)

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
    expect(setUser).toHaveBeenCalledWith(mockUser)
    expect(locationStub.href).toBe('/dashboard')
  })

  it('submitting the form calls authAPI.login() when social capability is disabled too', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(LOCAL_ONLY_METHODS)
    vi.mocked(authAPI.login).mockResolvedValue({
      status: 'authenticated',
      token: 'jwt-local',
      sessionId: 'sess-local',
      user: { id: 'u2', email: 'dev@local', firstName: 'D', lastName: 'V', roles: ['user'] },
    } as any)
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue({
      id: 'u2', email: 'dev@local', firstName: 'D', lastName: 'V', roles: ['user'],
    })

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'dev@local' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'pw' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    })

    expect(authAPI.login).toHaveBeenCalledTimes(1)
  })

  // ── 2b: Clicking the Google button starts the social login redirect ───────

  it('clicking "Sign in with Google" calls authAPI.startSocialLogin("google")', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)

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
    // Simulates landing on the login page after a social provider error.
    // handleAuthCallback reads those params and returns { error: '...' }.
    vi.mocked(authAPI.handleAuthCallback).mockResolvedValue({
      error: 'access_denied',
    })
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(LOCAL_ONLY_METHODS)

    render(<LoginPage />)

    // The component sets error state → renders the error block.
    await waitFor(() => {
      expect(screen.getByText(/authentication error/i)).toBeInTheDocument()
    })
    // The error detail from the callback is shown below the header.
    expect(screen.getByText(/access_denied/i)).toBeInTheDocument()
  })

  // ── 5: Successful callback result → getCurrentUser → navigate to /dashboard

  it('completes login and navigates to /dashboard when handleAuthCallback returns a session', async () => {
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

    // handleAuthCallback returns a successful session result.
    vi.mocked(authAPI.handleAuthCallback).mockResolvedValue({
      result: { status: 'authenticated', token: 'jwt-test-token', sessionId: 'sess-1', user: mockUser },
    })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser)

    render(<LoginPage />)

    // Component calls getCurrentUser after receiving the session result.
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

  // ── 6: Sign-up mode toggle switches the form to signup ───────────────────

  it('clicking the sign-up toggle button switches form to signup mode', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)

    render(<LoginPage />)

    // Wait for the page to settle with auth methods loaded.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'signUp' })).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'signUp' }))
    })

    // In signup mode the submit button reads "Create account".
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    // The toggle now offers "Back to sign in".
    expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument()
  })

  // ── 7: Per-action pending labels — only the clicked button shows progress ─

  it('clicking Google shows "Redirecting" ONLY on the Google button; the others just disable', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)
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
