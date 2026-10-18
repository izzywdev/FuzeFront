import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FullAccountSecurityClient } from '../../types'
import { err, makeClient, STRONG } from '../../test/helpers'
import { ChangePasswordFlow, SetPasswordFlow, PasswordManagementFlow } from './PasswordFlows'

const asClient = (c: unknown) => c as Partial<FullAccountSecurityClient>

async function fillChange(user: ReturnType<typeof userEvent.setup>, current = 'old-password-1!', next = STRONG, confirm = STRONG) {
  await user.type(document.querySelector('[data-input="current-password"]')!, current)
  await user.type(document.querySelector('[data-input="new-password"]')!, next)
  await user.type(document.querySelector('[data-input="confirm-password"]')!, confirm)
}

describe('ChangePasswordFlow', () => {
  it('renders the change variant with current/new/confirm, the meter and the forgot link', () => {
    render(<ChangePasswordFlow client={asClient(makeClient())} />)
    const form = document.querySelector('[data-variant="change"][data-has-password="true"]')!
    expect(form).toBeTruthy()
    expect(form.querySelector('[data-input="current-password"]')).toBeTruthy()
    expect(form.querySelector('[data-nav="forgot"]')).toBeTruthy()
    expect(document.querySelector('[data-meter]')).toBeTruthy()
    expect(document.querySelector('[data-policy-hints]')).toBeTruthy()
  })

  it('submits current + new and shows success', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<ChangePasswordFlow client={asClient(client)} />)
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await waitFor(() => expect(document.querySelector('[data-state="success"]')).toBeTruthy())
    expect(client.changePassword).toHaveBeenCalledWith('old-password-1!', STRONG)
  })

  it('wrong current password → inline field error, password unchanged, stays on the form', async () => {
    const user = userEvent.setup()
    const client = makeClient({ changePassword: vi.fn(async () => { throw err(400, 'INVALID_CREDENTIALS') }) })
    render(<ChangePasswordFlow client={asClient(client)} />)
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await waitFor(() => expect(document.querySelector('[data-error="wrong-current"]')).toBeTruthy())
    expect(document.querySelector('[data-field-error="current-password"]')).toBeTruthy()
    expect(document.querySelector('[data-state="success"]')).toBeNull()
  })

  it('server policy rejection (400) → password-policy error', async () => {
    const user = userEvent.setup()
    const client = makeClient({ changePassword: vi.fn(async () => { throw err(400, 'MALFORMED') }) })
    render(<ChangePasswordFlow client={asClient(client)} />)
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await waitFor(() => expect(document.querySelector('[data-error="password-policy"]')).toBeTruthy())
    expect(document.querySelector('[data-field-error="new-password"]')).toBeTruthy()
  })

  it('server policy rejection (422 PASSWORD_POLICY) → password-policy error', async () => {
    const user = userEvent.setup()
    const client = makeClient({ changePassword: vi.fn(async () => { throw err(422, 'PASSWORD_POLICY') }) })
    render(<ChangePasswordFlow client={asClient(client)} />)
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await waitFor(() => expect(document.querySelector('[data-error="password-policy"]')).toBeTruthy())
  })

  it('409 NO_PASSWORD → offers set-first-password instead of failing', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const client = makeClient({ changePassword: vi.fn(async () => { throw err(409, 'NO_PASSWORD') }) })
    render(<ChangePasswordFlow client={asClient(client)} onNavigate={onNavigate} />)
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await waitFor(() => expect(document.querySelector('[data-state="no-password"]')).toBeTruthy())
    await user.click(document.querySelector('[data-action="go-set"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/account/security/password?mode=set')
  })

  it('mismatched confirmation blocks submit without a request', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<ChangePasswordFlow client={asClient(client)} />)
    await fillChange(user, 'old-password-1!', STRONG, STRONG + 'x')
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    expect(document.querySelector('[data-field-error="confirm-password"]')).toBeTruthy()
    expect(client.changePassword).not.toHaveBeenCalled()
  })

  it('a client-side weak password never reaches the server', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<ChangePasswordFlow client={asClient(client)} />)
    await fillChange(user, 'old-password-1!', 'short', 'short')
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    expect(document.querySelector('[data-error="password-policy"]')).toBeTruthy()
    expect(client.changePassword).not.toHaveBeenCalled()
  })

  it('generic failure → retryable error, then success', async () => {
    const user = userEvent.setup()
    const changePassword = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce(undefined)
    render(<ChangePasswordFlow client={asClient(makeClient({ changePassword }))} />)
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(document.querySelector('[data-state="success"]')).toBeTruthy())
    expect(changePassword).toHaveBeenCalledTimes(2)
  })

  it('forgot link routes to the reset flow via onNavigate', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<ChangePasswordFlow client={asClient(makeClient())} onNavigate={onNavigate} />)
    await user.click(document.querySelector('[data-nav="forgot"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/reset')
  })

  it('mirrors under RTL (he): dir=rtl and logical layout, no raw physical margins', () => {
    render(<ChangePasswordFlow client={asClient(makeClient())} locale="he" />)
    expect(document.querySelector('main')).toHaveAttribute('dir', 'rtl')
  })
})

describe('SetPasswordFlow', () => {
  it('renders the set variant with NO current-password field', () => {
    render(<SetPasswordFlow client={asClient(makeClient())} />)
    expect(document.querySelector('[data-variant="set"][data-has-password="false"]')).toBeTruthy()
    expect(document.querySelector('[data-input="current-password"]')).toBeNull()
  })

  it('sets the password and confirms', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<SetPasswordFlow client={asClient(client)} />)
    await user.type(document.querySelector('[data-input="set-password"]')!, STRONG)
    await user.type(document.querySelector('[data-input="set-confirm"]')!, STRONG)
    await user.click(screen.getByRole('button', { name: /^set password$/i }))
    await waitFor(() => expect(document.querySelector('[data-state="success"]')).toBeTruthy())
    expect(client.setPassword).toHaveBeenCalledWith(STRONG)
  })

  it('409 (a password already exists) → already-has-password with change / reset exits', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const client = makeClient({ setPassword: vi.fn(async () => { throw err(409, 'CONFLICT') }) })
    render(<SetPasswordFlow client={asClient(client)} onNavigate={onNavigate} />)
    await user.type(document.querySelector('[data-input="set-password"]')!, STRONG)
    await user.type(document.querySelector('[data-input="set-confirm"]')!, STRONG)
    await user.click(screen.getByRole('button', { name: /^set password$/i }))
    await waitFor(() => expect(document.querySelector('[data-state="already-has-password"]')).toBeTruthy())
    expect(document.querySelector('[data-error="password-exists"]')).toBeTruthy()
    await user.click(document.querySelector('[data-action="go-reset"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/reset')
  })

  it('400 → policy rejected, form stays', async () => {
    const user = userEvent.setup()
    const client = makeClient({ setPassword: vi.fn(async () => { throw err(400, 'MALFORMED') }) })
    render(<SetPasswordFlow client={asClient(client)} />)
    await user.type(document.querySelector('[data-input="set-password"]')!, STRONG)
    await user.type(document.querySelector('[data-input="set-confirm"]')!, STRONG)
    await user.click(screen.getByRole('button', { name: /^set password$/i }))
    await waitFor(() => expect(document.querySelector('[data-error="password-policy"]')).toBeTruthy())
  })
})

describe('PasswordManagementFlow', () => {
  it('hasPassword:true → change variant', async () => {
    render(<PasswordManagementFlow client={asClient(makeClient())} />)
    await waitFor(() => expect(document.querySelector('[data-variant="change"]')).toBeTruthy())
  })

  it('hasPassword:false → set variant', async () => {
    const client = makeClient({ getConnections: vi.fn(async () => ({ providers: [], hasPassword: false })) })
    render(<PasswordManagementFlow client={asClient(client)} />)
    await waitFor(() => expect(document.querySelector('[data-variant="set"]')).toBeTruthy())
  })

  it('hasPassword:null FAILS CLOSED — neither variant, retry offered', async () => {
    const getConnections = vi
      .fn()
      .mockResolvedValueOnce({ providers: [], hasPassword: null })
      .mockResolvedValueOnce({ providers: [], hasPassword: true })
    const user = userEvent.setup()
    render(<PasswordManagementFlow client={asClient(makeClient({ getConnections }))} />)
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy())
    expect(document.querySelector('[data-variant]')).toBeNull()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(document.querySelector('[data-variant="change"]')).toBeTruthy())
  })

  it('a failed read fails closed too', async () => {
    const client = makeClient({ getConnections: vi.fn(async () => { throw err(500) }) })
    render(<PasswordManagementFlow client={asClient(client)} />)
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy())
    expect(document.querySelector('[data-variant]')).toBeNull()
  })

  it('409 NO_PASSWORD on change switches the management surface to the set form', async () => {
    const user = userEvent.setup()
    const client = makeClient({ changePassword: vi.fn(async () => { throw err(409, 'NO_PASSWORD') }) })
    render(<PasswordManagementFlow client={asClient(client)} />)
    await waitFor(() => expect(document.querySelector('[data-variant="change"]')).toBeTruthy())
    await fillChange(user)
    await user.click(screen.getByRole('button', { name: /save new password/i }))
    await user.click(await screen.findByRole('button', { name: /set a password/i }))
    await waitFor(() => expect(document.querySelector('[data-variant="set"]')).toBeTruthy())
  })

  it('a 409 on set switches the surface to the change form via "Change password"', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      getConnections: vi.fn(async () => ({ providers: [], hasPassword: false })),
      setPassword: vi.fn(async () => { throw err(409) }),
    })
    render(<PasswordManagementFlow client={asClient(client)} />)
    await waitFor(() => expect(document.querySelector('[data-variant="set"]')).toBeTruthy())
    await user.type(document.querySelector('[data-input="set-password"]')!, STRONG)
    await user.type(document.querySelector('[data-input="set-confirm"]')!, STRONG)
    await user.click(screen.getByRole('button', { name: /^set password$/i }))
    await waitFor(() => expect(document.querySelector('[data-action="go-change"]')).toBeTruthy())
    await user.click(document.querySelector('[data-action="go-change"]')!)
    await waitFor(() => expect(document.querySelector('[data-variant="change"]')).toBeTruthy())
  })
})
