import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectedAccountsPanel } from './ConnectedAccountsPanel'
import { HttpError } from '../api/http'
import type { AccountSecurityClient } from '../types'

const baseClient = (overrides: Partial<AccountSecurityClient> = {}): AccountSecurityClient => ({
  getConnections: vi.fn(async () => ({ providers: [{ provider: 'google' }], hasPassword: true })),
  getMethods: vi.fn(async () => ({
    password: true,
    social: ['google'],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })),
  unlinkProvider: vi.fn(async () => {}),
  linkProvider: vi.fn(async () => ({ redirectUrl: 'https://app.fuzefront.com/social/google/start' })),
  setPassword: vi.fn(async () => ({ providers: [], hasPassword: true })),
  ...overrides,
})

describe('ConnectedAccountsPanel', () => {
  it('renders the loading state, then the panel + sign-in-methods list', async () => {
    render(<ConnectedAccountsPanel client={baseClient()} />)
    expect(document.querySelector("[data-state='loading']")).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector("[data-panel='sign-in-methods']")).not.toBeNull()
    )
    expect(document.querySelector("[data-panel='connected-accounts']")).not.toBeNull()
    expect(document.querySelector("[data-connection='google']")).not.toBeNull()
  })

  it('renders the load-error state and retries', async () => {
    const client = baseClient({
      getConnections: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ providers: [{ provider: 'google' }], hasPassword: true }),
    })
    render(<ConnectedAccountsPanel client={client} />)
    const retry = await screen.findByRole('button', { name: /try again/i })
    expect(document.querySelector("[data-state='error']")).not.toBeNull()
    await userEvent.click(retry)
    await waitFor(() =>
      expect(document.querySelector("[data-panel='sign-in-methods']")).not.toBeNull()
    )
  })

  it('shows the Connect affordance for an unlinked provider, and the redirecting confirm on click', async () => {
    const client = baseClient({ getConnections: vi.fn(async () => ({ providers: [], hasPassword: true })) })
    render(<ConnectedAccountsPanel client={client} />)
    const connectBtn = await screen.findByRole('button', { name: /connect google/i })
    expect(document.querySelector("[data-connect='google']")).not.toBeNull()
    await userEvent.click(connectBtn)
    expect(document.querySelector("[data-state='redirecting']")).not.toBeNull()
  })

  it('follows the redirectUrl on Continue', async () => {
    const navigateExternal = vi.fn()
    const client = baseClient({ getConnections: vi.fn(async () => ({ providers: [], hasPassword: true })) })
    render(<ConnectedAccountsPanel client={client} navigateExternal={navigateExternal} />)
    await userEvent.click(await screen.findByRole('button', { name: /connect google/i }))
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    await waitFor(() =>
      expect(navigateExternal).toHaveBeenCalledWith('https://app.fuzefront.com/social/google/start')
    )
  })

  it('cancels back to the connect affordance', async () => {
    const client = baseClient({ getConnections: vi.fn(async () => ({ providers: [], hasPassword: true })) })
    render(<ConnectedAccountsPanel client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: /connect google/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(document.querySelector("[data-state='redirecting']")).toBeNull()
    expect(await screen.findByRole('button', { name: /connect google/i })).toBeInTheDocument()
  })

  it('shows link-failed when linkProvider rejects with a non-409 error', async () => {
    const client = baseClient({
      getConnections: vi.fn(async () => ({ providers: [], hasPassword: true })),
      linkProvider: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    render(<ConnectedAccountsPanel client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: /connect google/i }))
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(await screen.findByText(/wasn't connected/i)).toBeInTheDocument()
    expect(document.querySelector("[data-state='link-failed']")).not.toBeNull()
  })

  it('shows already-linked when linkProvider rejects with 409', async () => {
    const client = baseClient({
      getConnections: vi.fn(async () => ({ providers: [], hasPassword: true })),
      linkProvider: vi.fn(async () => {
        throw new HttpError(409, 'already linked', { error: 'x', code: 'ALREADY_LINKED' })
      }),
    })
    render(<ConnectedAccountsPanel client={client} />)
    await userEvent.click(await screen.findByRole('button', { name: /connect google/i }))
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(await screen.findByText(/already connected/i)).toBeInTheDocument()
    expect(document.querySelector("[data-state='already-linked']")).not.toBeNull()
  })

  it('renders the linked return state from the `linkedProvider` prop', async () => {
    render(<ConnectedAccountsPanel client={baseClient()} linkedProvider="google" />)
    expect(await screen.findByText(/google connected/i)).toBeInTheDocument()
    expect(document.querySelector("[data-state='linked'][data-linked='google']")).not.toBeNull()
  })

  it('renders link-failed from the `errorProvider` prop (return-trip cancellation)', async () => {
    const client = baseClient({ getConnections: vi.fn(async () => ({ providers: [], hasPassword: true })) })
    render(<ConnectedAccountsPanel client={client} errorProvider="google" />)
    expect(await screen.findByText(/wasn't connected/i)).toBeInTheDocument()
  })

  it('proactively disables unlink and shows the set-password-first guard on a social-only account', async () => {
    const client = baseClient({
      getConnections: vi.fn(async () => ({ providers: [{ provider: 'google' }], hasPassword: false })),
    })
    const onSetPassword = vi.fn()
    render(<ConnectedAccountsPanel client={client} onSetPassword={onSetPassword} />)
    await waitFor(() => expect(document.querySelector("[data-connection='google']")).not.toBeNull())
    expect(document.querySelector("[data-guard='set-password-first']")).not.toBeNull()
    const unlinkBtn = screen.getByRole('button', { name: /remove/i })
    expect(unlinkBtn).toBeDisabled()
  })

  it('surfaces the reactive last-sign-in-method 409 guard on unlink', async () => {
    const client = baseClient({
      getConnections: vi.fn(async () => ({ providers: [{ provider: 'google' }], hasPassword: true })),
      unlinkProvider: vi.fn(async () => {
        throw new HttpError(409, 'last method', { error: 'x', code: 'CONFLICT' })
      }),
    })
    render(<ConnectedAccountsPanel client={client} />)
    const unlinkBtn = await screen.findByRole('button', { name: /remove/i })
    await userEvent.click(unlinkBtn)
    expect(await screen.findByText(/keep at least one way to sign in/i)).toBeInTheDocument()
    expect(document.querySelector("[data-guard='last-sign-in-method']")).not.toBeNull()
  })
})
