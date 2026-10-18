/**
 * auth-experience.host.test.tsx (FFRNT-360 review fixes)
 *   - the single-use ?token= is lifted out of the URL before anything else runs
 *   - a 401 from verify-confirm / reset-confirm does NOT clear the session
 *   - resend never sends an email, and the check-inbox page has no edit action
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import axios, { AxiosError } from 'axios'

const setActiveValue = vi.fn()
vi.mock('../lib/accounts', async () => {
  const actual = await vi.importActual<typeof import('../lib/accounts')>('../lib/accounts')
  return { ...actual, setActiveValue: (...a: unknown[]) => setActiveValue(...a) }
})
vi.mock('../assets/FuzeFrontLogo.svg', () => ({ default: 'logo.png' }))
vi.mock('../lib/shared', () => ({ useCurrentUser: vi.fn() }))

import * as sharedMock from '../lib/shared'
import {
  captureSingleUseParams,
  takeSingleUseParam,
  _resetSingleUseParams,
} from '../lib/singleUseParams'

function setFlag(on: boolean | undefined) {
  const w = window as unknown as { __FF_AUTH_EXPERIENCE__?: boolean }
  if (on === undefined) delete w.__FF_AUTH_EXPERIENCE__
  else w.__FF_AUTH_EXPERIENCE__ = on
}

describe('single-use token capture (Referer / telemetry leak)', () => {
  afterEach(() => {
    setFlag(undefined)
    _resetSingleUseParams()
    window.history.replaceState({}, '', '/')
  })

  it.each(['/verify/email', '/reset'])('%s: token is stashed and the URL is clean immediately', path => {
    setFlag(true)
    window.history.replaceState({}, '', `${path}?token=sekret&email=a%40b.co#x`)
    captureSingleUseParams()
    expect(window.location.search).toBe('?email=a%40b.co') // only the token is gone
    expect(window.location.href).not.toContain('sekret')
    expect(takeSingleUseParam('token')).toBe('sekret')
    expect(takeSingleUseParam('token')).toBe('sekret') // stable across re-renders
  })

  it('scrubs the token whatever the flag says (security property, not a UI feature)', () => {
    for (const flag of [false, undefined]) {
      setFlag(flag)
      window.history.replaceState({}, '', '/reset?token=sekret')
      captureSingleUseParams()
      expect(window.location.search).toBe('')
      expect(takeSingleUseParam('token')).toBe('sekret')
      _resetSingleUseParams()
    }
  })

  it.each(['/verify/email', '/reset'])('%s: fragment token (#token=, never sent to the server) is stashed and scrubbed', path => {
    window.history.replaceState({}, '', `${path}?email=a%40b.co#token=frag`)
    captureSingleUseParams()
    expect(window.location.href).not.toContain('frag')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?email=a%40b.co')
    expect(takeSingleUseParam('token')).toBe('frag')
  })

  it('keeps an unrelated fragment untouched', () => {
    window.history.replaceState({}, '', '/reset?token=sekret#section')
    captureSingleUseParams()
    expect(window.location.hash).toBe('#section')
  })

  it('ignores other paths', () => {
    setFlag(true)
    window.history.replaceState({}, '', '/somewhere?token=keep')
    captureSingleUseParams()
    expect(window.location.search).toBe('?token=keep')
  })

  it('in-app navigation: take() reads then strips the live URL', () => {
    window.history.replaceState({}, '', '/reset?token=late')
    expect(takeSingleUseParam('token')).toBe('late')
    expect(window.location.search).toBe('')
  })
})

describe('401 on token redemption must not clear the session', () => {
  beforeEach(() => {
    setActiveValue.mockClear()
    vi.resetModules()
  })

  async function loadApiWith401() {
    axios.defaults.adapter = async config => {
      throw new AxiosError('x', 'ERR_BAD_REQUEST', config, {}, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: { code: 'NOT_ACTIVE' },
      } as any)
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'group').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    return (await import('../services/api')).authAPI
  }

  it('verify/email/confirm 401 keeps the session', async () => {
    const authAPI = await loadApiWith401()
    await expect(authAPI.confirmEmailVerification({ token: 't' })).rejects.toBeTruthy()
    expect(setActiveValue).not.toHaveBeenCalledWith('authToken', null)
  })

  it('reset-confirm 401 keeps the session', async () => {
    const authAPI = await loadApiWith401()
    await expect(authAPI.confirmPasswordReset({ token: 't', newPassword: 'x' })).rejects.toBeTruthy()
    expect(setActiveValue).not.toHaveBeenCalledWith('authToken', null)
  })

  it('any other 401 still clears the session (unchanged)', async () => {
    const authAPI = await loadApiWith401()
    await expect(authAPI.getVerificationStatus()).rejects.toBeTruthy()
    expect(setActiveValue).toHaveBeenCalledWith('authToken', null)
  })
})

describe('AuthExperiencePages', () => {
  afterEach(() => {
    _resetSingleUseParams()
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('check-inbox: shows the SESSION email over the query, resends with no email, no edit link, has Continue', async () => {
    vi.useFakeTimers()
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: { id: 'u', email: 'session@x.io' },
      isAuthenticated: true,
    } as any)
    window.history.replaceState({}, '', '/signup/verify?email=attacker%40evil.io')
    const { authAPI } = await import('../services/api')
    const start = vi.spyOn(authAPI, 'startEmailVerification').mockResolvedValue()
    const { VerifyCheckInboxPage } = await import('../pages/AuthExperiencePages')
    const { container } = render(<VerifyCheckInboxPage />)
    expect(container.querySelector('[data-value="email"]')).toHaveTextContent('session@x.io')
    expect(screen.queryByText(/go back and edit/i)).toBeNull()
    expect(container.querySelector('[data-action="continue"]')).toHaveAttribute('href', '/dashboard')
    expect(container.querySelector('[data-action="sign-in-for-link"]')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(61_000)
    })
    await act(async () => {
      fireEvent.click(container.querySelector('[data-action="resend"]')!)
    })
    expect(start).toHaveBeenCalledWith()
  })

  it('check-inbox honours an allowlisted next= for Continue, ignores anything else; signed-out gets sign-in not resend', async () => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({ user: null, isAuthenticated: false } as any)
    window.history.replaceState({}, '', '/signup/verify?email=a%40b.co&next=%2Ffuzepicker%2Fmentions%2F9')
    const { VerifyCheckInboxPage } = await import('../pages/AuthExperiencePages')
    const first = render(<VerifyCheckInboxPage />)
    expect(first.container.querySelector('[data-action="continue"]')).toHaveAttribute('href', '/fuzepicker/mentions/9')
    expect(first.container.querySelector('[data-action="resend"]')).toBeNull()
    expect(first.container.querySelector('[data-action="sign-in-for-link"]')).not.toBeNull()
    first.unmount()
    window.history.replaceState({}, '', '/signup/verify?next=https%3A%2F%2Fevil.example')
    const second = render(<VerifyCheckInboxPage />)
    expect(second.container.querySelector('[data-action="continue"]')).toHaveAttribute('href', '/dashboard')
  })

  it('reset "Back to sign in": with another account signed in, enters add-account mode first', async () => {
    window.history.replaceState({}, '', '/reset')
    window.localStorage.clear()
    window.sessionStorage.clear()
    const accounts = await import('../lib/accounts')
    accounts.rememberAccount({ id: 'acct-a', email: 'a@x.io', firstName: 'A', lastName: 'A' } as any, { token: 'tok-a' })
    expect(accounts.getActiveAuthToken()).toBe('tok-a')
    expect(accounts.isAddingAccount()).toBe(false)
    const { ResetPage } = await import('../pages/AuthExperiencePages')
    const { container } = render(<ResetPage />)
    const loc = window.location
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...loc, href: '' } })
    fireEvent.click(container.querySelector('.fzf-vr-foot a')!)
    expect(accounts.isAddingAccount()).toBe(true)
    expect(accounts.getActiveAuthToken()).toBeNull() // the shell would now boot to the sign-in form
    expect(window.location.href).toBe('/login')
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: loc })
  })

  it('reset "Back to sign in" with no session is a plain /login (no add-account mode)', async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/reset')
    const accounts = await import('../lib/accounts')
    const { ResetPage } = await import('../pages/AuthExperiencePages')
    const { container } = render(<ResetPage />)
    const loc = window.location
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...loc, href: '' } })
    fireEvent.click(container.querySelector('.fzf-vr-foot a')!)
    expect(accounts.isAddingAccount()).toBe(false)
    expect(window.location.href).toBe('/login')
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: loc })
  })

  it('landing signed-out + expired token: offers sign-in with a return path, no anonymous resend', async () => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({ user: null, isAuthenticated: false } as any)
    window.history.replaceState({}, '', '/verify/email?token=old')
    const { authAPI } = await import('../services/api')
    vi.spyOn(authAPI, 'confirmEmailVerification').mockRejectedValue({ response: { status: 401, data: { code: 'NOT_ACTIVE' } } })
    const start = vi.spyOn(authAPI, 'startEmailVerification').mockResolvedValue()
    const { VerifyLandingPage } = await import('../pages/AuthExperiencePages')
    render(<VerifyLandingPage />)
    const link = await screen.findByRole('link', { name: /sign in to get a new link/i })
    expect(link).toHaveAttribute('href', '/login?next=/signup/verify')
    expect(start).not.toHaveBeenCalled()
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
