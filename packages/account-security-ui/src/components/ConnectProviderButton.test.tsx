import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectProviderButton } from './ConnectProviderButton'
import { AccountSecurityI18nProvider } from '../i18n/AccountSecurityI18nProvider'

describe('ConnectProviderButton', () => {
  it('renders the data-connect hook and invokes onConnect with the provider', async () => {
    const onConnect = vi.fn()
    render(
      <AccountSecurityI18nProvider>
        <ConnectProviderButton provider="google" onConnect={onConnect} />
      </AccountSecurityI18nProvider>
    )
    expect(document.querySelector("[data-connect='google']")).not.toBeNull()
    const btn = screen.getByRole('button', { name: /connect google/i })
    expect(btn).toHaveAttribute('data-action', 'connect')
    expect(btn).toHaveAttribute('data-provider', 'google')
    await userEvent.click(btn)
    expect(onConnect).toHaveBeenCalledWith('google')
  })

  it('disables the affordance while busy', () => {
    render(
      <AccountSecurityI18nProvider>
        <ConnectProviderButton provider="google" onConnect={vi.fn()} busy />
      </AccountSecurityI18nProvider>
    )
    expect(screen.getByRole('button', { name: /connect google/i })).toBeDisabled()
  })
})
