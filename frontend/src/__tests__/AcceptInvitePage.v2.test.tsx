import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AcceptInvitePage from '../pages/AcceptInvitePage'
import { tokenFromLocation } from '../pages/AcceptInvitePageV2'
import { AppProvider } from '../lib/shared'
import { LanguageProvider } from '../contexts/LanguageContext'
import * as api from '../services/api'
import * as shared from '../lib/shared'
import { clearPendingInvite, readPendingInvite } from '../lib/pendingInvite'

// Org invitations v2 (FFRNT-309): flag `fuzefront.identity.invite-v2`, default OFF.
// The anonymous accept page resolves the flag pre-auth (`window.__FF_INVITE_V2__`).

const RESOLVED = {
  invitation: {
    id: 'inv_01hy',
    maskedContact: 'j***@acme.com',
    channel: 'email',
    role: 'admin',
    memberType: 'employee',
    status: 'pending',
    expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
  },
  organization: { id: 'org_1', name: 'Northwind' },
}

function respond(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }
}

function renderPage(path = '/invitations/tok_abc123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <AppProvider>
          <Routes>
            <Route path="/invitations/:token" element={<AcceptInvitePage />} />
          </Routes>
        </AppProvider>
      </LanguageProvider>
    </MemoryRouter>
  )
}

const flag = (on: boolean | undefined) => {
  ;(window as unknown as { __FF_INVITE_V2__?: boolean }).__FF_INVITE_V2__ = on
}

describe('AcceptInvitePage — flag fuzefront.identity.invite-v2', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.sessionStorage.clear()
  })
  afterEach(() => {
    flag(undefined)
    vi.unstubAllGlobals()
    clearPendingInvite()
  })

  it('OFF (default): today\'s page is unchanged', async () => {
    flag(false)
    vi.spyOn(api, 'getInvitation').mockResolvedValue({
      invitation: { id: 'i', email: 'user@example.com', role: 'member', expires_at: '', status: 'pending' },
      organization: { id: 'o', name: 'Acme Corp', slug: 'acme' },
    })
    renderPage()
    expect(await screen.findByText(/sign in to accept/i)).toBeInTheDocument()
    expect(document.querySelector('[data-panel="accept-resolve"]')).not.toBeInTheDocument()
  })

  it('ON: resolves server-side and shows org, role and member type', async () => {
    flag(true)
    const fetchMock = vi.fn().mockResolvedValue(respond(200, RESOLVED))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Northwind' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/invitations/tok_abc123')
    const summary = document.querySelector('[data-panel="invite-summary"]') as HTMLElement
    expect(summary.querySelector('[data-value="member-type"]')).toHaveTextContent('Employee')
    expect(summary.querySelector('[data-value="invite-email"]')).toHaveTextContent('j***@acme.com')
  })

  it('ON: carries the token through "Create account" and signs up with the bindToken (closes the token-drop gap)', async () => {
    flag(true)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, RESOLVED)) // resolve
      .mockResolvedValueOnce(respond(202, { action: 'enroll', enrollUrl: 'https://x/enroll', bindToken: 'bind_123' })) // accept (anon)
      .mockResolvedValueOnce(respond(409, { error: 'already accepted' })) // accept after sign-up (bind already done)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(api.authAPI, 'getAuthMethods').mockResolvedValue({
      password: true,
      social: ['google', 'facebook'] as never,
      mfa: { enabled: false, types: [] },
      verification: { email: false, sms: false },
    })
    const signup = vi
      .spyOn(api.authAPI, 'signup')
      .mockResolvedValue({ token: 'tok', sessionId: 's1', user: { id: 'u1', email: 'jordan@acme.com' } as never })
    vi.spyOn(api.authAPI, 'getCurrentUser').mockResolvedValue({ id: 'u1', email: 'jordan@acme.com' } as never)

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Create account & accept' }))

    // The opaque token is parked so a sign-in / social round trip can return here.
    await screen.findByRole('heading', { name: 'Create your account' })
    expect(readPendingInvite()).toBe('tok_abc123')
    expect(document.querySelector('[data-panel="accept-signup"]')).toBeInTheDocument()
    // Google AND Facebook offered (server advertises both); no sign-in/sign-up toggle.
    expect(await screen.findByRole('button', { name: 'Continue with Facebook' })).toHaveAttribute('data-action', 'social-facebook')
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /back to sign in/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jordan@acme.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!!!!pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account & join' }))

    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jordan@acme.com', bindToken: 'bind_123' })
      )
    )
    // Post-sign-up the bind is confirmed and shown (409 right after sign-up == already bound).
    await waitFor(() => expect(document.querySelector('[data-state="bound"]')).toBeInTheDocument())
    expect(document.querySelector('[data-panel="bind-success"] [data-value="member-type"]')).toHaveTextContent('Employee')
    expect(readPendingInvite()).toBeNull() // cleared once bound
  })

  it('ON: an authenticated returnee with a pending token auto-binds without a click', async () => {
    flag(true)
    window.sessionStorage.setItem('fuzefront:invite:pending', 'tok_abc123')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, RESOLVED))
      .mockResolvedValueOnce(
        respond(200, { action: 'bound', organizationId: 'org_1', userId: 'usr_1', role: 'admin', memberType: 'employee' })
      )
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(shared, 'useCurrentUser').mockReturnValue({
      isAuthenticated: true,
      user: { id: 'u1', email: 'jordan@acme.com' } as never,
      currentUser: { id: 'u1', email: 'jordan@acme.com' } as never,
      setCurrentUser: vi.fn(),
      setUser: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-state="bound"]')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(readPendingInvite()).toBeNull()
  })

  it('ON: 410 renders the expired card in place (no redirect)', async () => {
    flag(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(410, { error: 'gone' })))
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-state="token-invalid"]')).toBeInTheDocument())
    expect(document.querySelector('[data-error-code="INVITATION_EXPIRED"]')).toHaveAttribute('data-http', '410')
  })

  it('ON: "sign in to accept" parks the token before leaving for the sign-in page', async () => {
    flag(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, RESOLVED)))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /already have an account/i }))
    expect(readPendingInvite()).toBe('tok_abc123')
  })
})

describe('tokenFromLocation', () => {
  it('prefers the router param, falls back to the path (AppContent renders outside a Route) and ?token=', () => {
    expect(tokenFromLocation('tok_1', '/x', '')).toBe('tok_1')
    expect(tokenFromLocation(undefined, '/invitations/tok_2', '')).toBe('tok_2')
    expect(tokenFromLocation(undefined, '/invitations/accept', '?token=tok_3')).toBe('tok_3')
  })
  it('rejects unsafe or missing tokens', () => {
    expect(tokenFromLocation(undefined, '/invitations/accept', '')).toBeNull()
    expect(tokenFromLocation(undefined, '/invitations/..%2Fevil', '')).toBeNull()
    expect(tokenFromLocation(undefined, '/invitations/accept', '?token=https://evil.test')).toBeNull()
  })
})
