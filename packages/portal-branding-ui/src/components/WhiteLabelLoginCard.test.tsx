import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhiteLabelLoginCard } from './WhiteLabelLoginCard'
import type { NormalizedPortalContext } from '../types'

const CORPABC: NormalizedPortalContext = {
  id: 'prt_corpabc',
  slug: 'corpabc',
  isRoot: false,
  branding: {
    name: 'CorpABC',
    logo: null,
    favicon: null,
    accent: '#2452e8',
    tagline: 'Your team, connected.',
  },
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WhiteLabelLoginCard', () => {
  it('renders the branded surface and never the string "FuzeFront" (white-label invariant)', () => {
    render(<WhiteLabelLoginCard context={CORPABC} />)
    const surface = screen.getByText('Sign in').closest('[data-whitelabel="true"]') as HTMLElement
    expect(surface).toBeVisible()
    expect(surface.textContent).not.toContain('FuzeFront')
    expect(screen.getByRole('button', { name: /sign in to corpabc/i })).toBeVisible()
  })

  it('email/password fields are labeled (a11y), with no native `required` blocking submission', () => {
    // No `required`: the RED spec (and the real cross-portal-rejection flow)
    // submits with empty fields and expects the SERVER to reject — a native
    // `required` attribute would block that submit event before our onSubmit
    // ever runs.
    render(<WhiteLabelLoginCard context={CORPABC} />)
    const email = screen.getByLabelText('Email') as HTMLInputElement
    const password = screen.getByLabelText('Password') as HTMLInputElement
    expect(email).not.toBeRequired()
    expect(password).not.toBeRequired()
    expect(email.type).toBe('email')
    expect(password.type).toBe('password')
  })

  it('posts to /api/v1/security/session and redirects on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { token: 'tok_123' }))
    vi.stubGlobal('fetch', fetchMock)
    const originalLocation = window.location
    // jsdom's window.location.href setter throws "Not implemented: navigation" —
    // stub it so a successful submit doesn't fail the test on an unrelated jsdom gap.
    const windowAny = window as unknown as Record<string, unknown>
    delete windowAny.location
    windowAny.location = { ...originalLocation, href: '' }

    render(<WhiteLabelLoginCard context={CORPABC} />)
    await userEvent.type(screen.getByLabelText('Email'), 'jordan@corpabc.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /sign in to corpabc/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/security/session', expect.objectContaining({ method: 'POST' })))
    // The session must land in the shell's ACCOUNT VAULT namespace, not at a
    // bare `authToken` — a bare key is read by nothing and would leave the user
    // signed in server-side but booted unauthenticated.
    await waitFor(() =>
      expect(localStorage.getItem('ff.acct.__provisional__.authToken')).toBe('tok_123')
    )
    expect(localStorage.getItem('authToken')).toBeNull()

    windowAny.location = originalLocation
    localStorage.removeItem('ff.acct.__provisional__.authToken')
  })

  it('renders the cross-portal-reject fail-closed state on a 403 cross_portal_rejected response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        code: 'cross_portal_rejected',
        message: "This account isn't part of CorpABC.",
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<WhiteLabelLoginCard context={CORPABC} />)
    await userEvent.type(screen.getByLabelText('Email'), 'someone@other-tenant.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /sign in to corpabc/i }))

    const rejection = await screen.findByText(/isn't part of CorpABC/i)
    expect(rejection.closest('[data-state="cross-portal-reject"]')).toBeVisible()
    expect(screen.getByRole('button', { name: /use a different account/i })).toBeVisible()
  })

  it('a network failure never throws — it renders a generic sign-in error instead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )
    render(<WhiteLabelLoginCard context={CORPABC} />)
    await userEvent.type(screen.getByLabelText('Email'), 'jordan@corpabc.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /sign in to corpabc/i }))

    expect(await screen.findByText(/sign-in failed/i)).toBeVisible()
  })
})
