/**
 * LoginPage.broker-handoff.test.tsx
 *
 * Covers the consumer-product sign-in handoff (#238): a registered broker
 * client sends its user to `/login?client=<key>&redirect_uri=<callback>`.
 *   1. The page resolves and applies the client's public branding (logo,
 *      tagline) before the user authenticates.
 *   2. An unknown/unreachable client fails OPEN to default FuzeFront
 *      branding rather than erroring the page.
 *   3. On successful sign-in, the page mints a handoff code and navigates
 *      the browser to the product's redirectUri — NOT `/dashboard`.
 *   4. A handoff failure is surfaced in place; the page never silently
 *      falls through to `/dashboard` for a broker-initiated sign-in.
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

const REDIRECT_URI = 'https://marketplace.mendysrobotics.com/api/dsm/auth/callback'

/** Same approach as LoginPage.auth-panel-adapter.test.tsx, extended with `search`. */
function setLocation(pathname: string, search = '') {
  const stub = {
    search,
    pathname,
    href: `https://app.fuzefront.com${pathname}${search}`,
    origin: 'https://app.fuzefront.com',
  }
  Object.defineProperty(global, 'location', { value: stub, writable: true, configurable: true })
  return stub
}

describe('LoginPage — broker handoff (#238)', () => {
  let locationStub: ReturnType<typeof setLocation>

  beforeEach(() => {
    vi.clearAllMocks()
    locationStub = setLocation(
      '/login',
      `?client=mendys-datasets&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    )

    ;(sharedMock.useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue(makeUserCtx())

    vi.spyOn(authAPI, 'handleAuthCallback').mockResolvedValue({})
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(PASSWORD_ONLY)
    vi.spyOn(authAPI, 'getBrokerClient')
    vi.spyOn(authAPI, 'brokerHandoff')
    vi.spyOn(authAPI, 'login')
    vi.spyOn(authAPI, 'getCurrentUser')

    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves and renders the broker client branding (logo + tagline) before sign-in', async () => {
    vi.mocked(authAPI.getBrokerClient).mockResolvedValue({
      client: 'mendys-datasets',
      branding: {
        name: 'Mendys Datasets',
        logo: 'https://cdn.example.com/mendys-logo.png',
        favicon: null,
        accent: '#1a56db',
        tagline: 'Sign in to browse datasets',
      },
    })

    render(<LoginPage />)

    expect(authAPI.getBrokerClient).toHaveBeenCalledWith('mendys-datasets')
    await waitFor(() => expect(screen.getByText('Sign in to browse datasets')).toBeInTheDocument())
    expect(screen.getByAltText('Mendys Datasets')).toHaveAttribute(
      'src',
      'https://cdn.example.com/mendys-logo.png'
    )
  })

  it('fails open to default FuzeFront branding when the broker client is unknown', async () => {
    vi.mocked(authAPI.getBrokerClient).mockResolvedValue(null)

    render(<LoginPage />)
    await waitFor(() => expect(authAPI.getBrokerClient).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByAltText('FuzeFront')).toBeInTheDocument())
  })

  it('on successful sign-in, hands off to the product redirectUri instead of /dashboard', async () => {
    vi.mocked(authAPI.getBrokerClient).mockResolvedValue(null)
    const mockUser = { id: 'u1', email: 'ada@ex.com', firstName: 'Ada', lastName: 'Lovelace', roles: ['user'] }
    vi.mocked(authAPI.login).mockResolvedValue({ status: 'authenticated', token: 'tok-1', sessionId: 'sess-1', user: mockUser as any })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser as any)
    vi.mocked(authAPI.brokerHandoff).mockResolvedValue({
      redirectUri: `${REDIRECT_URI}?code=opaque-code-123`,
    })

    render(<LoginPage />)
    await waitFor(() => expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'S3cret!!!!' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    })

    await waitFor(() =>
      expect(authAPI.brokerHandoff).toHaveBeenCalledWith({
        client: 'mendys-datasets',
        redirectUri: REDIRECT_URI,
      })
    )
    expect(locationStub.href).toBe(`${REDIRECT_URI}?code=opaque-code-123`)
  })

  it('surfaces a handoff failure in place and never falls through to /dashboard', async () => {
    vi.mocked(authAPI.getBrokerClient).mockResolvedValue(null)
    const mockUser = { id: 'u1', email: 'ada@ex.com', firstName: 'Ada', lastName: 'Lovelace', roles: ['user'] }
    vi.mocked(authAPI.login).mockResolvedValue({ status: 'authenticated', token: 'tok-1', sessionId: 'sess-1', user: mockUser as any })
    vi.mocked(authAPI.getCurrentUser).mockResolvedValue(mockUser as any)
    const handoffErr: any = new Error('Request failed with status code 400')
    handoffErr.response = { status: 400, data: { error: 'redirectUri is not registered for this client' } }
    vi.mocked(authAPI.brokerHandoff).mockRejectedValue(handoffErr)

    render(<LoginPage />)
    await waitFor(() => expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'S3cret!!!!' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    })

    await waitFor(() =>
      expect(screen.getByText(/redirectUri is not registered for this client/i)).toBeInTheDocument()
    )
    expect(locationStub.href).not.toBe('/dashboard')
  })
})
