// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  StandaloneAuthBoundary,
  clearStandaloneSession,
  portalTokenProvider,
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
  delete (window as any).__FRONTFUSE_CONTEXT__
  vi.restoreAllMocks()
})

describe('standalone FuzeFront authentication', () => {
  it('preserves the host-owned token bridge when the portal mounts the web entry', () => {
    ;(window as any).__FRONTFUSE_CONTEXT__ = { getAccessToken: () => 'portal-token' }
    expect(portalTokenProvider()?.()).toBe('portal-token')
  })

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

  it('completes the FuzeFront MFA challenge before exposing the tenant session', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({
        status: 'mfa_required',
        challengeId: 'challenge-1',
        factors: [{ factorId: 'totp-1', type: 'totp' }],
      }))
      .mockImplementationOnce(() => response({ challengeId: 'challenge-1', factorId: 'totp-1', delivered: false }, 202))
      .mockImplementationOnce(() => response({ token: 'verified-token', sessionId: 'session-1' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: 'org-mfa' } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {session => <p>Authenticated {session.tenantId}</p>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'mfa@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))

    expect(await screen.findByRole('heading', { name: 'Verify your identity' })).toBeVisible()
    expect(screen.getByText('Enter the current code from your authenticator app.')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))

    expect(await screen.findByText('Authenticated org-mfa')).toBeVisible()
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/security/mfa/challenge', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ challengeId: 'challenge-1', factorId: 'totp-1' }),
    }))
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/v1/security/mfa/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ challengeId: 'challenge-1', factorId: 'totp-1', code: '123456' }),
    }))
    expect(readStandaloneSession()).toEqual({ token: 'verified-token', tenantId: 'org-mfa' })
  })

  it('keeps MFA fail-closed when Security rejects the verification code', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({
        status: 'mfa_required',
        challengeId: 'challenge-1',
        factors: [{ factorId: 'email-1', type: 'email' }],
      }))
      .mockImplementationOnce(() => response({ challengeId: 'challenge-1', factorId: 'email-1', delivered: true }, 202))
      .mockImplementationOnce(() => response({ error: 'Invalid or expired verification code' }, 401))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {() => <p>Authenticated</p>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'mfa@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired verification code')
    expect(screen.getByRole('heading', { name: 'Verify your identity' })).toBeVisible()
    expect(readStandaloneSession()).toBeNull()
  })
})
