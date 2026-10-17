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
    saveStandaloneSession({ token: 'stored-token', tenantId: 'canonical-tenant' })
    const fetcher = vi.fn(() => response({ identity: { tenantId: 'canonical-tenant' } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {session => <p>Tenant {session.tenantId}</p>}
      </StandaloneAuthBoundary>,
    )

    expect(await screen.findByText('Tenant canonical-tenant')).toBeVisible()
    expect(readStandaloneSession()).toEqual({ token: 'stored-token', tenantId: 'canonical-tenant' })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/security/session?tenant=canonical-tenant', {
      headers: { authorization: 'Bearer stored-token' },
    })
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
      .mockImplementationOnce(() => response({ workspaces: [] }))

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

  it('retries a workspace discovery outage without resubmitting credentials', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ status: 'authenticated', token: 'session-token' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: null } }))
      .mockImplementationOnce(() => response({ error: 'Workspace discovery unavailable' }, 503))
      .mockImplementationOnce(() => response({ identity: { tenantId: null } }))
      .mockImplementationOnce(() => response({
        workspaces: [{ id: 'personal-org-1', name: 'Personal', type: 'personal' }],
      }))
      .mockImplementationOnce(() => response({ identity: { tenantId: 'personal-org-1' } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {session => <p>Authenticated {session.tenantId}</p>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace discovery unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry workspace discovery' }))

    expect(await screen.findByText('Authenticated personal-org-1')).toBeVisible()
    expect(fetcher.mock.calls.filter(
      ([url, init]) => url === '/api/v1/security/session' && init?.method === 'POST'
    )).toHaveLength(1)
    expect(readStandaloneSession()).toEqual({ token: 'session-token', tenantId: 'personal-org-1' })
  })

  it('discovers and proves the only active workspace after Authentik sign-in', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ status: 'authenticated', token: 'session-token' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: null } }))
      .mockImplementationOnce(() => response({
        workspaces: [{ id: 'personal-org-1', name: 'Personal', type: 'personal' }],
      }))
      .mockImplementationOnce(() => response({ identity: { tenantId: 'personal-org-1' } }))

    await expect(signInStandalone('owner@example.com', 'secret', fetcher as typeof fetch)).resolves.toEqual({
      token: 'session-token',
      tenantId: 'personal-org-1',
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/v1/security/session/workspaces', {
      headers: { authorization: 'Bearer session-token' },
    })
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/v1/security/session?tenant=personal-org-1', {
      headers: { authorization: 'Bearer session-token' },
    })
  })

  it('requires an explicit scope choice when personal and organization workspaces exist', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ status: 'authenticated', token: 'session-token' }))
      .mockImplementationOnce(() => response({ identity: { tenantId: null } }))
      .mockImplementationOnce(() => response({ workspaces: [
        { id: 'personal-org-1', name: 'Personal workspace', type: 'personal' },
        { id: 'organization-1', name: 'Acme', type: 'organization' },
      ] }))
      .mockImplementationOnce(() => response({ identity: { tenantId: 'organization-1' } }))

    render(
      <StandaloneAuthBoundary fetcher={fetcher as typeof fetch}>
        {session => <p>Authenticated {session.tenantId}</p>}
      </StandaloneAuthBoundary>,
    )

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))

    expect(await screen.findByRole('group', { name: 'Available workspaces' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Personal workspace · Personal' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Acme · Organization' }))

    expect(await screen.findByText('Authenticated organization-1')).toBeVisible()
    expect(readStandaloneSession()).toEqual({ token: 'session-token', tenantId: 'organization-1' })
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/security/session?tenant=organization-1', {
      headers: { authorization: 'Bearer session-token' },
    })
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
