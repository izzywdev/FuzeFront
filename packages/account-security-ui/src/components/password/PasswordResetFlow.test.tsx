import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FullAccountSecurityClient } from '../../types'
import { err, makeClient, STRONG } from '../../test/helpers'
import { PasswordResetFlow } from './PasswordResetFlow'

const asClient = (c: unknown) => c as Partial<FullAccountSecurityClient>

describe('PasswordResetFlow — request', () => {
  it('renders the request step and posts the email', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<PasswordResetFlow client={asClient(client)} />)
    expect(document.querySelector('[data-panel="reset-request"]')).toBeTruthy()
    await user.type(document.querySelector('[data-input="email"]')!, 'jordan@example.com')
    await user.click(document.querySelector('[data-action="send-reset"]')!)
    await waitFor(() => expect(document.querySelector('[data-panel="reset-sent"][data-http="202"]')).toBeTruthy())
    expect(client.requestPasswordReset).toHaveBeenCalledWith('jordan@example.com')
    expect(document.querySelector('[data-security-note="no-enumeration"]')).toBeTruthy()
  })

  it('NEVER surfaces a request failure — the confirmation is identical (no enumeration oracle)', async () => {
    const user = userEvent.setup()
    const client = makeClient({ requestPasswordReset: vi.fn(async () => { throw err(500) }) })
    render(<PasswordResetFlow client={asClient(client)} />)
    await user.type(document.querySelector('[data-input="email"]')!, 'nobody@example.com')
    await user.click(document.querySelector('[data-action="send-reset"]')!)
    await waitFor(() => expect(document.querySelector('[data-panel="reset-sent"]')).toBeTruthy())
    expect(document.querySelector('[data-state="error"]')).toBeNull()
  })

  it('the sent copy never asserts the account exists', async () => {
    const user = userEvent.setup()
    render(<PasswordResetFlow client={asClient(makeClient())} />)
    await user.type(document.querySelector('[data-input="email"]')!, 'a@example.com')
    await user.click(document.querySelector('[data-action="send-reset"]')!)
    await waitFor(() => expect(document.querySelector('[data-panel="reset-sent"]')).toBeTruthy())
    expect(screen.getByText(/if an account exists/i)).toBeInTheDocument()
  })

  it('resend posts again', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<PasswordResetFlow client={asClient(client)} />)
    await user.type(document.querySelector('[data-input="email"]')!, 'a@example.com')
    await user.click(document.querySelector('[data-action="send-reset"]')!)
    await waitFor(() => expect(document.querySelector('[data-action="resend"]')).toBeTruthy())
    await user.click(document.querySelector('[data-action="resend"]')!)
    await waitFor(() => expect(client.requestPasswordReset).toHaveBeenCalledTimes(2))
  })

  it('a malformed email is rejected client-side with no request', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<PasswordResetFlow client={asClient(client)} />)
    await user.type(document.querySelector('[data-input="email"]')!, 'nope')
    await user.click(document.querySelector('[data-action="send-reset"]')!)
    expect(client.requestPasswordReset).not.toHaveBeenCalled()
  })
})

describe('PasswordResetFlow — confirm with token', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, pw = STRONG, confirm = STRONG) {
    await user.type(document.querySelector('[data-input="new-password"]')!, pw)
    await user.type(document.querySelector('[data-input="confirm-password"]')!, confirm)
    await user.click(document.querySelector('[data-action="set-new-password"]')!)
  }

  it('valid token: posts { token, newPassword } then shows done with the sessions-revoked note', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()
    const client = makeClient()
    render(<PasswordResetFlow client={asClient(client)} token="tok_abc" onSignIn={onSignIn} />)
    expect(document.querySelector('[data-panel="reset-confirm"][data-token-state="valid"]')).toBeTruthy()
    await fill(user)
    await waitFor(() => expect(document.querySelector('[data-panel="reset-done"]')).toBeTruthy())
    expect(client.confirmPasswordReset).toHaveBeenCalledWith('tok_abc', STRONG)
    expect(document.querySelector('[data-security-note="sessions-revoked"]')).toBeTruthy()
    await user.click(document.querySelector('[data-action="go-sign-in"]')!)
    expect(onSignIn).toHaveBeenCalled()
  })

  it('expired / consumed token (400) → token-invalid with a way to request a new link', async () => {
    const user = userEvent.setup()
    const client = makeClient({ confirmPasswordReset: vi.fn(async () => { throw err(400, 'MALFORMED') }) })
    render(<PasswordResetFlow client={asClient(client)} token="tok_old" />)
    await fill(user)
    await waitFor(() => expect(document.querySelector('[data-token-state="invalid"]')).toBeTruthy())
    await user.click(document.querySelector('[data-action="request-again"]')!)
    expect(document.querySelector('[data-panel="reset-request"]')).toBeTruthy()
  })

  it('a policy-failing password shows the policy error and sends nothing', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<PasswordResetFlow client={asClient(client)} token="tok" />)
    await fill(user, 'password', 'password')
    expect(document.querySelector('[data-error="password-policy"]')).toBeTruthy()
    expect(client.confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('a server fault (5xx) → generic retryable error, not a misleading "expired link"', async () => {
    const user = userEvent.setup()
    const confirmPasswordReset = vi.fn().mockRejectedValueOnce(err(503)).mockResolvedValueOnce(undefined)
    render(<PasswordResetFlow client={asClient(makeClient({ confirmPasswordReset }))} token="tok" />)
    await fill(user)
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy())
    expect(document.querySelector('[data-token-state="invalid"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(document.querySelector('[data-panel="reset-done"]')).toBeTruthy())
  })
})
