// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  StandaloneAuthBoundary,
  clearStandaloneSession,
  readStandaloneSession,
  saveStandaloneSession,
  signInStandalone,
} from './standaloneAuth'

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
}))

afterEach(() => {
  cleanup()
  clearStandaloneSession()
  vi.restoreAllMocks()
})

describe('standalone FuzeFront authentication', () => {
  it('exchanges credentials then hydrates the canonical tenant before exposing a session', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ status: 'authenticated', token: 'session-token' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: 'personal-org-1' } }))

    await expect(signInStandalone('owner@example.com', 'secret', fetcher as typeof fetch)).resolves.toEqual({
      token: 'session-token',
      tenantId: 'personal-org-1',
    })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/security/session', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', password: 'secret' }),
    }))
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/security/session', {
      headers: { authorization: 'Bearer session-token' },
    })
  })

  it('restores a stored session through Security before rendering tenant data', async () => {
    saveStandaloneSession({ token: 'stored-token', tenantId: 'stale-tenant' })
    const fetcher = vi.fn(() => response({ identity: { tenantId: 'canonical-tenant' } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {session => <p>Tenant {session.tenantId}</p>}
      </StandaloneAuthBoundary>,
    )

    expect(await screen.findByText('Tenant canonical-tenant')).toBeVisible()
    expect(readStandaloneSession()).toEqual({ token: 'stored-token', tenantId: 'canonical-tenant' })
  })

  it('shows the standalone sign-in surface and persists an authenticated workspace', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ status: 'authenticated', token: 'new-token' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: 'org-1' } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {session => <p>Authenticated {session.tenantId}</p>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))

    expect(await screen.findByText('Authenticated org-1')).toBeVisible()
    expect(readStandaloneSession()).toEqual({ token: 'new-token', tenantId: 'org-1' })
  })

  it('revokes and clears the standalone session on sign-out', async () => {
    saveStandaloneSession({ token: 'stored-token', tenantId: 'org-1' })
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ identity: { tenantId: 'org-1' } }))
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {(_session, signOut) => <button onClick={signOut}>End session</button>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'End session' }))
    expect(await screen.findByRole('button', { name: 'Sign in securely' })).toBeVisible()
    expect(readStandaloneSession()).toBeNull()
    await waitFor(() => expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/security/session', {
      method: 'DELETE',
      headers: { authorization: 'Bearer stored-token' },
    }))
  })

  it('fails closed when Security cannot resolve a personal or organization tenant', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ status: 'authenticated', token: 'session-token' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: null } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {() => <p>Authenticated</p>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('does not have an active personal or organization workspace')
    expect(readStandaloneSession()).toBeNull()
  })
})
