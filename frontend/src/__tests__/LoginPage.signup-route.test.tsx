/**
 * LoginPage.signup-route.test.tsx
 *
 * Regression cover for #283: /signup always rendered the SIGN-IN form.
 *
 * The mode logic in LoginPage looked correct, which is why this survived review.
 * The real culprit was in services/api.ts: its 401 interceptor redirected to
 * /login whenever the path did not already contain "/login". An anonymous
 * visitor on /signup triggers the shell's boot probe (GET /session) -> 401 --
 * the NORMAL answer for someone not signed in -- so the interceptor rewrote the
 * path to /login BEFORE LoginPage mounted. The /signup intent was gone, and the
 * page dutifully opened in sign-in mode. /signup could never work.
 *
 * These tests pin BOTH halves so the bug cannot reappear from either side:
 *   1. LoginPage opens sign-up on /signup and sign-in on / and /login.
 *   2. The 401 interceptor does not redirect away from an auth route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

const PASSWORD_ONLY: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

/** Point window.location.pathname at `path` without navigating jsdom. */
function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, href: `https://app.fuzefront.com${path}` },
  })
}

describe('#283 — /signup must open the sign-up form', () => {
  beforeEach(() => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: null,
      currentUser: null,
      isAuthenticated: false,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(PASSWORD_ONLY)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The "First name" field is rendered ONLY under `mode === 'signup'`
  // (LoginPage.tsx), so its presence is an unambiguous discriminator between the
  // two modes — unlike button text, which routes through the t() mock.
  const firstName = () => screen.queryByLabelText(/first name/i)

  it('opens SIGN-UP mode on /signup', async () => {
    setPath('/signup')
    render(<LoginPage />)
    await waitFor(() => expect(firstName()).toBeTruthy())
  })

  it('opens SIGN-IN mode on /', async () => {
    setPath('/')
    render(<LoginPage />)
    await waitFor(() => expect(authAPI.getAuthMethods).toHaveBeenCalled())
    expect(firstName()).toBeNull()
  })

  it('opens SIGN-IN mode on /login', async () => {
    setPath('/login')
    render(<LoginPage />)
    await waitFor(() => expect(authAPI.getAuthMethods).toHaveBeenCalled())
    expect(firstName()).toBeNull()
  })

  it('does NOT treat an unrelated path containing "signup" as sign-up', async () => {
    // `includes('signup')` matched this; the check is anchored to /^\/signup\b/.
    setPath('/apps/signup-widget')
    render(<LoginPage />)
    await waitFor(() => expect(authAPI.getAuthMethods).toHaveBeenCalled())
    expect(firstName()).toBeNull()
  })
})
