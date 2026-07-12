/**
 * LoginPage.google-signin.test.tsx
 *
 * Component-level unit tests for the Google Sign-In (via Authentik OIDC) flow
 * on the LoginPage.
 *
 * Architecture reminder:
 *   User → "Sign in with Authentik" → backend /api/auth/oidc/login
 *        → Authentik (has Google button) → user completes Google auth
 *        → Authentik callback → backend /api/auth/oidc/callback
 *        → backend mints short-lived exchange code → redirect to frontend
 *          with ?code=<32-byte-hex>
 *        → frontend handleOIDCCallback() reads ?code= and POSTs to
 *          /api/auth/token-exchange
 *        → backend returns { token: JWT, sessionId }
 *        → frontend stores token, fetches /api/auth/user, navigates to /dashboard
 *
 * What is NOT tested here (already covered by handleOIDCCallback.test.ts):
 *   - The internals of authAPI.handleOIDCCallback (?code= exchange, error
 *     param handling, empty URL, ?token= security boundary).
 *
 * What IS tested here:
 *   1. OIDC button visibility based on oidcConfigured flag
 *   2. Clicking OIDC button calls loginWithOIDC
 *   3. Error from handleOIDCCallback is surfaced on the page
 *   4. Successful token from handleOIDCCallback triggers getCurrentUser + redirect
 *   5. Sign-Up affordance button also calls loginWithOIDC
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

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

/** Minimal AuthMethods shape with OIDC disabled. */
const LOCAL_ONLY_METHODS = {
  methods: ['local'] as string[],
  oidcConfigured: false,
  defaultMethod: 'local',
}

/** Minimal AuthMethods shape with OIDC enabled. */
const OIDC_METHODS = {
  methods: ['local', 'oidc'] as string[],
  oidcConfigured: true,
  defaultMethod: 'oidc',
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('LoginPage — OIDC / Google Sign-In UI', () => {
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
    vi.spyOn(authAPI, 'handleOIDCCallback').mockResolvedValue({})
    vi.spyOn(authAPI, 'getAuthMethods')
    vi.spyOn(authAPI, 'loginWithOIDC').mockResolvedValue(undefined)
    vi.spyOn(authAPI, 'loginWithAuthentikPassword')
    vi.spyOn(authAPI, 'login')
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

  // ── 1: No Google button, local-auth form fallback when oidcConfigured=false

  it('renders the credentials form but no Google button when oidcConfigured is false', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(LOCAL_ONLY_METHODS)

    render(<LoginPage />)

    // Wait for auth methods to have loaded (the credentials form is the
    // sentinel — it only renders once authMethods state is set).
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()

    expect(screen.queryByText(/sign in with authentik/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument()
  })

  // ── 2: Native credentials form + Google button when oidcConfigured is true

  it('renders the credentials form AND "Sign in with Google" (no Authentik redirect button) when oidcConfigured is true', async () => {
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
    // The redirect button is gone — Authentik is driven server-side instead.
    expect(screen.queryByText(/sign in with authentik/i)).not.toBeInTheDocument()
  })

  // ── 2a: Form submit verifies credentials AGAINST AUTHENTIK when configured

  it('submitting the form calls loginWithAuthentikPassword (not local login) when oidcConfigured is true', async () => {
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
    vi.mocked(authAPI.loginWithAuthentikPassword).mockResolvedValue({
      token: 'jwt-authentik',
      sessionId: 'sess-ak',
      user: mockUser,
    } as any)

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

    expect(authAPI.loginWithAuthentikPassword).toHaveBeenCalledWith({
      email: 'someone@example.com',
      password: 'hunter22',
    })
    expect(authAPI.login).not.toHaveBeenCalled()
    expect(setUser).toHaveBeenCalledWith(mockUser)
    expect(locationStub.href).toBe('/dashboard')
  })

  it('submitting the form calls the LOCAL login when oidcConfigured is false', async () => {
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(LOCAL_ONLY_METHODS)
    vi.mocked(authAPI.login).mockResolvedValue({
      token: 'jwt-local',
      sessionId: 'sess-local',
      user: { id: 'u2', email: 'dev@local', firstName: 'D', lastName: 'V', roles: ['user'] },
    } as any)

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
    expect(authAPI.loginWithAuthentikPassword).not.toHaveBeenCalled()
  })

  // ── 2b: Clicking the Google button starts the Authentik OIDC redirect ────

  it('clicking "Sign in with Google" calls authAPI.loginWithOIDC (Google is federated via Authentik)', async () => {
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

    expect(authAPI.loginWithOIDC).toHaveBeenCalledTimes(1)
  })

  // ── 4: Error from handleOIDCCallback surfaces on the page ───────────────

  it('shows "Authentication Error" on page when handleOIDCCallback returns an error', async () => {
    // Simulates landing on the login page after an OIDC provider error
    // (?error=oidc_error&message=access_denied in the URL).
    // handleOIDCCallback reads those params and returns { error: '...' }.
    vi.mocked(authAPI.handleOIDCCallback).mockResolvedValue({
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

  // ── 5: Successful callback token → getCurrentUser → navigate to /dashboard

  it('completes login and navigates to /dashboard when handleOIDCCallback returns a token', async () => {
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

    // handleOIDCCallback returns a token (from a ?code= exchange that already
    // happened internally — the real function is tested in handleOIDCCallback.test.ts).
    vi.mocked(authAPI.handleOIDCCallback).mockResolvedValue({
      token: 'jwt-test-token',
      sessionId: 'sess-1',
    })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser)

    render(<LoginPage />)

    // Component calls getCurrentUser after receiving the token.
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

  // ── 6: Sign-Up affordance button also calls loginWithOIDC ───────────────

  it('Sign-Up button at the bottom also calls loginWithOIDC (OIDC enrollment path)', async () => {
    // The sign-up button is always rendered (not conditional on oidcConfigured).
    // It routes new users through Authentik enrollment — the same OIDC path.
    vi.mocked(authAPI.getAuthMethods).mockResolvedValue(OIDC_METHODS)

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

    expect(authAPI.loginWithOIDC).toHaveBeenCalledTimes(1)
  })
})
