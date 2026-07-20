import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignInMethodsList } from './SignInMethodsList'
import { AccountSecurityI18nProvider } from '../i18n/AccountSecurityI18nProvider'
import { HttpError } from '../api/http'
import type { IdentityConnections } from '../types'

const connections: IdentityConnections = {
  providers: [{ provider: 'google' }],
  hasPassword: false,
}

describe('SignInMethodsList', () => {
  it('renders the last-sign-in-method guard when unlink fails with 409', async () => {
    const onUnlink = vi.fn(async () => {
      throw new HttpError(409, 'last method', { error: 'x', code: 'CONFLICT' })
    })
    render(
      <AccountSecurityI18nProvider>
        <SignInMethodsList connections={connections} onUnlink={onUnlink} />
      </AccountSecurityI18nProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    const guard = await screen.findByText(/keep at least one way to sign in/i)
    expect(guard).toBeInTheDocument()
    expect(
      document.querySelector('[data-guard="last-sign-in-method"]')
    ).not.toBeNull()
  })

  it('does not show the guard when unlink succeeds', async () => {
    const onUnlink = vi.fn(async () => {})
    render(
      <AccountSecurityI18nProvider>
        <SignInMethodsList connections={connections} onUnlink={onUnlink} />
      </AccountSecurityI18nProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onUnlink).toHaveBeenCalledWith('google')
    expect(document.querySelector('[data-guard="last-sign-in-method"]')).toBeNull()
  })
})
