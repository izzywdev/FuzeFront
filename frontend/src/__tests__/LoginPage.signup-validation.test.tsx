/**
 * LoginPage.signup-validation.test.tsx
 *
 * Covers the two signup gaps closed here:
 *   1. Confirm-password with live match validation (submit disabled until match).
 *   2. Debounced inline email-availability (idle → checking → available/taken),
 *      failing OPEN when the endpoint errors so it never blocks account creation.
 *
 * Also asserts the password-policy hints surface. All UI is design-system-first
 * (FieldStatus + PasswordChecklist from @fuzefront/design-system).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { AuthMethods } from '@fuzefront/security-client'

vi.mock('../assets/FuzeFrontLogo.svg', () => ({ default: 'mock-logo.png' }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'en', setLanguage: vi.fn() }),
}))
vi.mock('../lib/shared', () => ({ useCurrentUser: vi.fn() }))

import LoginPage from '../pages/LoginPage'
import * as sharedMock from '../lib/shared'
import { authAPI } from '../services/api'

const PASSWORD_ONLY: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, href: `https://app.fuzefront.com${path}` },
  })
}

const STRONG = 'Sup3rSecret!Pass'

describe('signup — confirm-password + email availability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: null,
      currentUser: null,
      isAuthenticated: false,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(PASSWORD_ONLY)
    vi.spyOn(authAPI, 'checkEmailAvailability').mockResolvedValue({
      email: 'a@b.com',
      available: true,
    })
    setPath('/signup')
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function renderSignup() {
    render(<LoginPage />)
    // getAuthMethods resolves the credentials form.
    await vi.waitFor(() => expect(screen.queryByLabelText(/first name/i)).toBeTruthy())
  }

  it('shows the password-policy hints in signup mode', async () => {
    await renderSignup()
    expect(screen.getByText(/at least 12 characters/i)).toBeTruthy()
    expect(screen.getByText(/a symbol/i)).toBeTruthy()
  })

  it('renders a Confirm password field and errors on mismatch', async () => {
    await renderSignup()
    const confirm = screen.getByLabelText(/confirm password/i) as HTMLInputElement
    expect(confirm).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
    fireEvent.change(confirm, { target: { value: 'different' } })
    await waitFor(() => expect(screen.getByText(/passwords do not match/i)).toBeTruthy())
  })

  it('keeps submit disabled until the password is valid AND matches', async () => {
    await renderSignup()
    const submit = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true) // nothing typed yet

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: STRONG } })
    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  it('debounces then shows "taken" and blocks submit when email is unavailable', async () => {
    vi.spyOn(authAPI, 'checkEmailAvailability').mockResolvedValue({
      email: 'taken@b.com',
      available: false,
    })
    await renderSignup()
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'taken@b.com' } })

    // Not called before the debounce window elapses.
    expect(authAPI.checkEmailAvailability).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(450)
    expect(authAPI.checkEmailAvailability).toHaveBeenCalledWith('taken@b.com', expect.anything())

    await waitFor(() =>
      expect(screen.getByText(/already uses this email/i)).toBeTruthy()
    )
    const submit = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByRole('button', { name: /sign in instead/i })).toBeTruthy()
  })

  it('fails OPEN: an errored availability check does not block submit', async () => {
    vi.spyOn(authAPI, 'checkEmailAvailability').mockResolvedValue({
      email: 'x@b.com',
      available: null, // fail-open sentinel from api.ts
    })
    await renderSignup()
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'x@b.com' } })
    await vi.advanceTimersByTimeAsync(450)

    const submit = screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  it('does not probe availability in sign-in mode', async () => {
    setPath('/login')
    render(<LoginPage />)
    await waitFor(() => expect(authAPI.getAuthMethods).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
    await vi.advanceTimersByTimeAsync(500)
    expect(authAPI.checkEmailAvailability).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull()
  })
})
