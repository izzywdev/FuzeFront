import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountSecurityHub } from './AccountSecurityHub'
import type { AccountSecurityClient } from '../types'

const goodOverviewClient = (): AccountSecurityClient => ({
  getConnections: vi.fn(async () => ({ providers: [{ provider: 'google' }], hasPassword: true })),
  getMethods: vi.fn(async () => ({
    password: true,
    social: ['google'],
    mfa: { enabled: true, types: ['totp'] },
    verification: { email: true, sms: false },
  })),
  getActiveSessionCount: vi.fn(async () => 2),
})

describe('AccountSecurityHub', () => {
  it('shows the loading skeleton, then the hub with the good posture', async () => {
    render(<AccountSecurityHub client={goodOverviewClient()} />)
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /security posture/i })).toHaveAttribute(
        'data-posture',
        'good'
      )
    )
    expect(screen.getByText(/well protected/i)).toBeInTheDocument()
  })

  it('renders the load-error callout and retries on click', async () => {
    const failing: AccountSecurityClient = {
      getConnections: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
        providers: [],
        hasPassword: true,
      }),
      getMethods: vi.fn(async () => ({
        password: true,
        social: [],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
      })),
    }
    render(<AccountSecurityHub client={failing} />)
    const retry = await screen.findByRole('button', { name: /try again/i })
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
    await userEvent.click(retry)
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /security posture/i })).toBeInTheDocument()
    )
  })

  it('surfaces the social-only set-password guard when hasPassword is false', async () => {
    const socialOnly: AccountSecurityClient = {
      getConnections: vi.fn(async () => ({ providers: [{ provider: 'google' }], hasPassword: false })),
      getMethods: vi.fn(async () => ({
        password: true,
        social: ['google'],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
      })),
    }
    const onSetPassword = vi.fn()
    render(<AccountSecurityHub client={socialOnly} onSetPassword={onSetPassword} />)
    const guard = await screen.findByText(/set a password first/i)
    expect(guard).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /set a password/i }))
    expect(onSetPassword).toHaveBeenCalled()
  })

  it('mirrors to RTL under the he locale', async () => {
    render(<AccountSecurityHub client={goodOverviewClient()} locale="he" />)
    const main = await screen.findByRole('main')
    expect(main).toHaveAttribute('dir', 'rtl')
  })
})
