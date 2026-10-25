import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailVerificationFlow } from './EmailVerificationFlow'
import { PasswordResetFlow } from './PasswordResetFlow'
import { PasswordStrengthMeter, scorePassword } from './PasswordStrengthMeter'
import { PasswordConfirmField } from './PasswordConfirmField'
import { ResendCooldownButton, formatCountdown } from './ResendCooldownButton'
import { VerifyStatusPanel } from './VerifyStatusPanel'
import { classifyAuthError } from './errors'
import { isAuthExperienceEnabled } from '../../flags'
import type { VerifyResetTransport } from './types'

const STRONG = 'Rev0lution-99$x' // 15 chars, all rules → good
const VERY_STRONG = 'Rev0lution-99$xyz!' // 18 chars → strong

function makeTransport(over: Partial<VerifyResetTransport> = {}): VerifyResetTransport {
  return {
    startEmailVerification: vi.fn().mockResolvedValue(undefined),
    confirmEmailVerification: vi.fn().mockResolvedValue({ emailVerified: true, phoneVerified: false }),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    confirmPasswordReset: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}
const httpErr = (status: number, code?: string) => ({ response: { status, data: { code } } })

describe('classifyAuthError', () => {
  it('maps 429 / RATE_LIMITED, EXPIRED / INVALID_CODE, 5xx and plain 400', () => {
    expect(classifyAuthError(httpErr(429))).toBe('rate-limited')
    expect(classifyAuthError({ status: 400, code: 'RATE_LIMITED' })).toBe('rate-limited')
    expect(classifyAuthError(httpErr(400, 'EXPIRED'))).toBe('expired')
    expect(classifyAuthError(httpErr(400, 'INVALID_CODE'))).toBe('expired')
    expect(classifyAuthError(httpErr(503, 'PROVIDER_UNAVAILABLE'))).toBe('unavailable')
    expect(classifyAuthError(httpErr(400, 'MALFORMED'))).toBe('unknown')
    expect(classifyAuthError(httpErr(400, 'MALFORMED'), { badRequestIsExpired: true })).toBe('expired')
    expect(classifyAuthError(httpErr(400, 'TOKEN_EXPIRED'))).toBe('expired')
    expect(classifyAuthError(httpErr(400, 'TOKEN_INVALID'))).toBe('expired')
    expect(classifyAuthError(httpErr(400, 'INVALID_TOKEN'))).toBe('expired')
    expect(classifyAuthError(httpErr(401, 'NOT_ACTIVE'))).toBe('unknown')
    expect(classifyAuthError(httpErr(401, 'NOT_ACTIVE'), { notActiveIsExpired: true })).toBe('expired')
    expect(classifyAuthError(httpErr(422, 'PASSWORD_POLICY'))).toBe('policy')
    expect(classifyAuthError(httpErr(400, 'MALFORMED'), { malformedIsPolicy: true })).toBe('policy')
    expect(classifyAuthError(new Error('network'))).toBe('unknown')
    expect(classifyAuthError(undefined)).toBe('unknown')
  })
})

describe('isAuthExperienceEnabled (pre-auth flag, default OFF)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__FF_AUTH_EXPERIENCE__
  })
  it('is OFF by default', () => {
    expect(isAuthExperienceEnabled()).toBe(false)
  })
  it('honours the runtime override both ways', () => {
    ;(window as unknown as Record<string, unknown>).__FF_AUTH_EXPERIENCE__ = true
    expect(isAuthExperienceEnabled()).toBe(true)
    ;(window as unknown as Record<string, unknown>).__FF_AUTH_EXPERIENCE__ = false
    expect(isAuthExperienceEnabled()).toBe(false)
  })
})

describe('PasswordStrengthMeter', () => {
  it('scores against the policy rules', () => {
    expect(scorePassword('')).toBe('empty')
    expect(scorePassword('abc')).toBe('weak')
    expect(scorePassword('Abcdefghijk1')).toBe('fair') // missing only a symbol
    expect(scorePassword(STRONG)).toBe('good')
    expect(scorePassword(VERY_STRONG)).toBe('strong')
  })
  it('exposes data-pwmeter / data-strength and the matching word', () => {
    const { container, rerender } = render(<PasswordStrengthMeter value={STRONG} />)
    const meter = container.querySelector('[data-pwmeter]')!
    expect(meter).toHaveAttribute('data-strength', 'good')
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(3)
    expect(meter).toHaveAttribute('data-state', 'pw-good')
    rerender(<PasswordStrengthMeter value="abc" />)
    expect(container.querySelector('[data-pwmeter]')).toHaveAttribute('data-strength', 'weak')
  })
})

describe('PasswordConfirmField', () => {
  it('shows nothing until typed, then data-match true/false with an error on mismatch', () => {
    const { rerender } = render(<PasswordConfirmField password="abc" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('Confirm new password')
    expect(input).not.toHaveAttribute('data-match')
    rerender(<PasswordConfirmField password="abc" value="ab" onChange={() => {}} />)
    expect(input).toHaveAttribute('data-match', 'false')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText("Passwords don't match yet.")).toBeInTheDocument()
    rerender(<PasswordConfirmField password="abc" value="abc" onChange={() => {}} />)
    expect(input).toHaveAttribute('data-match', 'true')
  })
})

describe('ResendCooldownButton', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('formats m:ss', () => {
    expect(formatCountdown(44)).toBe('0:44')
    expect(formatCountdown(61)).toBe('1:01')
    expect(formatCountdown(-3)).toBe('0:00')
  })

  it('counts down disabled, re-enables, resends and restarts the cooldown', async () => {
    const onResend = vi.fn().mockResolvedValue(undefined)
    render(<ResendCooldownButton onResend={onResend} cooldownSeconds={3} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('data-state', 'cooldown')
    expect(btn).toHaveTextContent('Resend email in 0:03')
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(btn).toHaveTextContent('Resend email in 0:02')
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(btn).toBeEnabled()
    expect(btn).toHaveAttribute('data-state', 'ready')
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(onResend).toHaveBeenCalledTimes(1)
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('data-state', 'cooldown')
  })

  it('stays usable when the resend rejects', async () => {
    const onResend = vi.fn().mockRejectedValue(new Error('boom'))
    render(<ResendCooldownButton onResend={onResend} startInCooldown={false} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeEnabled()
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(btn).toBeEnabled()
    expect(btn).toHaveAttribute('data-state', 'ready')
  })
})

describe('VerifyStatusPanel', () => {
  it.each([
    ['verifying', 'Verifying your email…'],
    ['verified', 'Email verified'],
    ['expired', 'This link has expired'],
    ['error', 'Something went wrong. Please try again.'],
  ] as const)('renders %s', (status, heading) => {
    const { container } = render(<VerifyStatusPanel status={status} />)
    expect(container.querySelector(`[data-state="${status}"]`)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })
  it('routes the actions', async () => {
    const onContinue = vi.fn()
    const onResend = vi.fn()
    const { rerender } = render(<VerifyStatusPanel status="verified" onContinue={onContinue} />)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onContinue).toHaveBeenCalled()
    rerender(<VerifyStatusPanel status="expired" onResend={onResend} />)
    await userEvent.click(screen.getByRole('button', { name: /send a new link/i }))
    expect(onResend).toHaveBeenCalled()
  })
})

describe('EmailVerificationFlow — check inbox', () => {
  it('shows the email, a cooldown resend, and resends via the transport', async () => {
    vi.useFakeTimers()
    try {
      const transport = makeTransport()
      const { container } = render(
        <EmailVerificationFlow transport={transport} view="check-inbox" email="ada@lovelace.io" cooldownSeconds={2} canResend />,
      )
      expect(container.querySelector('[data-frame="03-check-inbox"]')).toBeInTheDocument()
      expect(container.querySelector('[data-value="email"]')).toHaveTextContent('ada@lovelace.io')
      const btn = container.querySelector('[data-action="resend"]') as HTMLButtonElement
      expect(btn).toBeDisabled()
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      await act(async () => {
        fireEvent.click(btn)
      })
      // NEVER sends an address: the server derives the target from the session.
      expect(transport.startEmailVerification).toHaveBeenCalledWith()
      expect(btn).toHaveAttribute('data-state', 'cooldown')
    } finally {
      vi.useRealTimers()
    }
  })

  it('429 shows the rate-limited state and keeps cooling down', async () => {
    vi.useFakeTimers()
    try {
      const transport = makeTransport({
        startEmailVerification: vi.fn().mockRejectedValue(httpErr(429, 'RATE_LIMITED')),
      })
      const { container } = render(
        <EmailVerificationFlow transport={transport} view="check-inbox" email="a@b.co" cooldownSeconds={1} canResend />,
      )
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {
        fireEvent.click(container.querySelector('[data-action="resend"]')!)
      })
      expect(container.querySelector('[data-state="rate-limited"]')).toBeInTheDocument()
      expect(container.querySelector('[data-action="resend"]')).toHaveAttribute('data-state', 'cooldown')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a generic failure shows an error and leaves resend usable', async () => {
    vi.useFakeTimers()
    try {
      const transport = makeTransport({ startEmailVerification: vi.fn().mockRejectedValue(new Error('x')) })
      const { container } = render(
        <EmailVerificationFlow transport={transport} view="check-inbox" email="a@b.co" cooldownSeconds={1} canResend />,
      )
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {
        fireEvent.click(container.querySelector('[data-action="resend"]')!)
      })
      expect(container.querySelector('[data-state="error"]')).toBeInTheDocument()
      expect(container.querySelector('[data-action="resend"]')).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('EmailVerificationFlow — verify landing', () => {
  it('verifying → verified; confirms with {token} exactly once', async () => {
    const transport = makeTransport()
    const onContinue = vi.fn()
    const { container } = render(
      <React.StrictMode>
        <EmailVerificationFlow transport={transport} view="landing" token="tok" onContinue={onContinue} />
      </React.StrictMode>,
    )
    expect(container.querySelector('[data-frame="04-verify-landing"]')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-state="verified"]')).toBeInTheDocument())
    expect(transport.confirmEmailVerification).toHaveBeenCalledTimes(1)
    expect(transport.confirmEmailVerification).toHaveBeenCalledWith({ token: 'tok' })
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onContinue).toHaveBeenCalled()
  })

  it('is in the verifying state while the request is in flight', () => {
    const transport = makeTransport({ confirmEmailVerification: vi.fn(() => new Promise<never>(() => {})) })
    const { container } = render(<EmailVerificationFlow transport={transport} view="landing" token="tok" />)
    expect(container.querySelector('[data-state="verifying"]')).toBeInTheDocument()
  })

  it.each(['EXPIRED', 'INVALID_CODE'])('%s → expired, and "send a new link" calls start', async code => {
    const transport = makeTransport({ confirmEmailVerification: vi.fn().mockRejectedValue(httpErr(400, code)) })
    const { container } = render(
      <EmailVerificationFlow transport={transport} view="landing" token="tok" canResend />,
    )
    await waitFor(() => expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /send a new link/i }))
    // NEVER sends an address: the server derives the target from the session.
      expect(transport.startEmailVerification).toHaveBeenCalledWith()
    expect(await screen.findByText('A new verification link is on its way.')).toBeInTheDocument()
  })

  it('signed-out expired link offers sign-in, NOT an anonymous resend', async () => {
    const transport = makeTransport({ confirmEmailVerification: vi.fn().mockRejectedValue(httpErr(400, 'EXPIRED')) })
    const { container } = render(
      <EmailVerificationFlow transport={transport} view="landing" token="t" signInForLinkHref="/login?next=/signup/verify" />,
    )
    await waitFor(() => expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /send a new link/i })).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: /sign in to get a new link/i })
    expect(link).toHaveAttribute('href', '/login?next=/signup/verify')
    expect(transport.startEmailVerification).not.toHaveBeenCalled()
  })

  describe('expired link resend target (multi-account)', () => {
    const expiredTransport = () =>
      makeTransport({ confirmEmailVerification: vi.fn().mockRejectedValue(httpErr(400, 'EXPIRED')) })

    it('one signed-in account: the button names it, plus a Not you? action', async () => {
      const transport = expiredTransport()
      const onUseAnotherAccount = vi.fn()
      const { container } = render(
        <EmailVerificationFlow
          transport={transport}
          view="landing"
          token="t"
          canResend
          accounts={[{ id: 'a', email: 'ada@lovelace.io' }]}
          onUseAnotherAccount={onUseAnotherAccount}
        />,
      )
      await waitFor(() => expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument())
      await userEvent.click(screen.getByRole('button', { name: 'Send a new link to ada@lovelace.io' }))
      expect(transport.startEmailVerification).toHaveBeenCalledWith()
      await userEvent.click(screen.getByRole('button', { name: /not you\? sign in to another account/i }))
      expect(onUseAnotherAccount).toHaveBeenCalled()
    })

    it('several accounts: shows a choice, no bare resend; sending targets the chosen account', async () => {
      const transport = expiredTransport()
      const { container } = render(
        <EmailVerificationFlow
          transport={transport}
          view="landing"
          token="t"
          canResend
          accounts={[
            { id: 'a', email: 'ada@lovelace.io' },
            { id: 'b', email: 'bob@example.com' },
          ]}
          onUseAnotherAccount={vi.fn()}
        />,
      )
      await waitFor(() => expect(container.querySelector('[data-state="choose-account"]')).toBeInTheDocument())
      expect(container.querySelector('[data-action="resend"]')).not.toBeInTheDocument()
      expect(screen.getByText('Which account is this link for?')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Send to bob@example.com' }))
      expect(transport.startEmailVerification).toHaveBeenCalledWith('b')
      expect(screen.getByRole('button', { name: /not you/i })).toBeInTheDocument()
    })
  })

  it('401 NOT_ACTIVE (expired token) renders expired, not a generic error', async () => {
    const transport = makeTransport({ confirmEmailVerification: vi.fn().mockRejectedValue(httpErr(401, 'NOT_ACTIVE')) })
    const { container } = render(<EmailVerificationFlow transport={transport} view="landing" token="t" canResend />)
    await waitFor(() => expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument())
  })

  it('a missing token is expired without calling the API', () => {
    const transport = makeTransport()
    const { container } = render(<EmailVerificationFlow transport={transport} view="landing" />)
    expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument()
    expect(transport.confirmEmailVerification).not.toHaveBeenCalled()
  })

  it('emailVerified:false is treated as not verified', async () => {
    const transport = makeTransport({
      confirmEmailVerification: vi.fn().mockResolvedValue({ emailVerified: false, phoneVerified: false }),
    })
    const { container } = render(<EmailVerificationFlow transport={transport} view="landing" token="t" />)
    await waitFor(() => expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument())
  })

  it('429 / outage / unknown failures render the generic error with a working retry', async () => {
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(httpErr(429))
      .mockResolvedValueOnce({ emailVerified: true, phoneVerified: false })
    const transport = makeTransport({ confirmEmailVerification: confirm })
    const { container } = render(<EmailVerificationFlow transport={transport} view="landing" token="t" />)
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).toBeInTheDocument())
    expect(screen.getByText('Too many attempts. Please wait a moment before trying again.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(container.querySelector('[data-state="verified"]')).toBeInTheDocument())
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('a failed "send a new link" surfaces a rate-limit / error notice', async () => {
    const transport = makeTransport({
      confirmEmailVerification: vi.fn().mockRejectedValue(httpErr(400, 'EXPIRED')),
      startEmailVerification: vi.fn().mockRejectedValue(httpErr(429)),
    })
    const { container } = render(<EmailVerificationFlow transport={transport} view="landing" token="t" canResend />)
    await waitFor(() => expect(container.querySelector('[data-state="expired"]')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /send a new link/i }))
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument()
  })
})

describe('PasswordResetFlow — request', () => {
  const email = (c: HTMLElement) => c.querySelector('input[name="email"]') as HTMLInputElement

  it('renders the request form and posts the address', async () => {
    const transport = makeTransport()
    const { container } = render(<PasswordResetFlow transport={transport} />)
    expect(container.querySelector('[data-frame="05-password-reset"]')).toBeInTheDocument()
    expect(container.querySelector('[data-step="request"]')).toBeInTheDocument()
    expect(container.querySelector('[data-action="submit"]')).toBeDisabled() // empty email
    await userEvent.type(email(container), 'ada@lovelace.io')
    await userEvent.click(container.querySelector('[data-action="submit"]')!)
    expect(transport.requestPasswordReset).toHaveBeenCalledWith('ada@lovelace.io')
    const sent = await waitFor(() => {
      const el = container.querySelector('[data-step="request-sent"]')
      expect(el).toBeInTheDocument()
      return el as HTMLElement
    })
    expect(sent).toHaveTextContent('ada@lovelace.io')
  })

  it('shows IDENTICAL copy whether or not the account exists (no enumeration)', async () => {
    const copy: string[] = []
    for (const addr of ['ada@lovelace.io', 'ghost@nowhere.example']) {
      const transport = makeTransport() // the API answers 202 for both
      const { container, unmount } = render(<PasswordResetFlow transport={transport} />)
      await userEvent.type(email(container), addr)
      await userEvent.click(container.querySelector('[data-action="submit"]')!)
      const sent = await waitFor(() => {
        const el = container.querySelector('[data-step="request-sent"]') as HTMLElement
        expect(el).toBeInTheDocument()
        return el
      })
      copy.push(sent.textContent!.replace(addr, '<email>'))
      unmount()
    }
    expect(copy[0]).toBe(copy[1])
    expect(copy[0]).toContain('If an account exists for <email>')
  })

  it('429 → rate-limited state, form retained', async () => {
    const transport = makeTransport({ requestPasswordReset: vi.fn().mockRejectedValue(httpErr(429, 'RATE_LIMITED')) })
    const { container } = render(<PasswordResetFlow transport={transport} initialEmail="a@b.co" />)
    await userEvent.click(container.querySelector('[data-action="submit"]')!)
    await waitFor(() => expect(container.querySelector('[data-state="rate-limited"]')).toBeInTheDocument())
    expect(container.querySelector('[data-form="reset-request"]')).toBeInTheDocument()
  })

  it('generic failure → error state, form retained', async () => {
    const transport = makeTransport({ requestPasswordReset: vi.fn().mockRejectedValue(new Error('net')) })
    const { container } = render(<PasswordResetFlow transport={transport} initialEmail="a@b.co" />)
    await userEvent.click(container.querySelector('[data-action="submit"]')!)
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).toBeInTheDocument())
    expect(container.querySelector('[data-form="reset-request"]')).toBeInTheDocument()
  })

  it('request-sent has a cooldown resend that re-posts', async () => {
    vi.useFakeTimers()
    try {
      const transport = makeTransport()
      const { container } = render(
        <PasswordResetFlow transport={transport} initialEmail="a@b.co" cooldownSeconds={1} />,
      )
      await act(async () => {
        fireEvent.click(container.querySelector('[data-action="submit"]')!)
      })
      const btn = container.querySelector('[data-step="request-sent"] [data-action="resend"]') as HTMLButtonElement
      expect(btn).toBeDisabled()
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {
        fireEvent.click(btn)
      })
      expect(transport.requestPasswordReset).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PasswordResetFlow — confirm', () => {
  const fill = async (c: HTMLElement, pw: string, confirm: string) => {
    await userEvent.type(c.querySelector('input[name="newPassword"]')!, pw)
    await userEvent.type(c.querySelector('input[name="confirm"]')!, confirm)
  }
  const submit = (c: HTMLElement) => c.querySelector('[data-form="reset-confirm"] [data-action="submit"]') as HTMLButtonElement

  it('opens on the confirm step when a token is present, gated by policy + match', async () => {
    const { container } = render(<PasswordResetFlow transport={makeTransport()} token="rst" />)
    expect(container.querySelector('[data-form="reset-confirm"]')).toBeInTheDocument()
    expect(container.querySelector('[data-pwmeter]')).toBeInTheDocument()
    expect(submit(container)).toHaveAttribute('aria-disabled', 'true')
    await fill(container, STRONG, 'Rev0lution-99$')
    expect(container.querySelector('input[name="confirm"]')).toHaveAttribute('data-match', 'false')
    expect(submit(container)).toHaveAttribute('aria-disabled', 'true')
  })

  it('a weak but matching password stays blocked', async () => {
    const transport = makeTransport()
    const { container } = render(<PasswordResetFlow transport={transport} token="rst" />)
    await fill(container, 'short', 'short')
    expect(submit(container)).toHaveAttribute('aria-disabled', 'true')
    fireEvent.submit(container.querySelector('[data-form="reset-confirm"]')!)
    expect(transport.confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('valid + matching → posts {token,newPassword} → done', async () => {
    const transport = makeTransport()
    const { container } = render(<PasswordResetFlow transport={transport} token="rst" />)
    await fill(container, STRONG, STRONG)
    expect(submit(container)).toHaveAttribute('aria-disabled', 'false')
    await userEvent.click(submit(container))
    expect(transport.confirmPasswordReset).toHaveBeenCalledWith({ token: 'rst', newPassword: STRONG })
    await waitFor(() => expect(container.querySelector('[data-step="confirm-done"]')).toBeInTheDocument())
  })

  it.each(['TOKEN_EXPIRED', 'TOKEN_INVALID'])('400 %s → confirm-expired; restart returns to the request form', async code => {
    const transport = makeTransport({ confirmPasswordReset: vi.fn().mockRejectedValue(httpErr(400, code)) })
    const { container } = render(<PasswordResetFlow transport={transport} token="rst" />)
    await fill(container, STRONG, STRONG)
    await userEvent.click(submit(container))
    await waitFor(() => expect(container.querySelector('[data-step="confirm-expired"]')).toBeInTheDocument())
    await userEvent.click(container.querySelector('[data-action="restart"]')!)
    expect(container.querySelector('[data-form="reset-request"]')).toBeInTheDocument()
  })

  it.each([
    ['422 PASSWORD_POLICY', httpErr(422, 'PASSWORD_POLICY')],
    ['legacy 400 MALFORMED', httpErr(400, 'MALFORMED')],
  ])('%s keeps the form with an inline policy error (not expired)', async (_n, err) => {
    const transport = makeTransport({ confirmPasswordReset: vi.fn().mockRejectedValue(err) })
    const { container } = render(<PasswordResetFlow transport={transport} token="rst" />)
    await fill(container, STRONG, STRONG)
    await userEvent.click(submit(container))
    expect(await screen.findByText(/does not meet the password policy/i)).toBeInTheDocument()
    expect(container.querySelector('[data-step="confirm-expired"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-form="reset-confirm"]')).toBeInTheDocument()
  })

  it('check-inbox signed out: offers sign-in, no resend button', () => {
    const transport = makeTransport()
    const { container } = render(<EmailVerificationFlow transport={transport} view="check-inbox" email="a@b.co" />)
    expect(container.querySelector('[data-action="resend"]')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in to get a new link/i })).toHaveAttribute(
      'href',
      '/login?next=/signup/verify',
    )
    expect(transport.startEmailVerification).not.toHaveBeenCalled()
  })

  it('check-inbox has no edit-address action and offers Continue to the app', () => {
    const { container } = render(
      <EmailVerificationFlow transport={makeTransport()} view="check-inbox" email="a@b.co" continueHref="/dashboard" />,
    )
    expect(screen.queryByText(/go back and edit/i)).not.toBeInTheDocument()
    expect(container.querySelector('[data-action="continue"]')).toHaveAttribute('href', '/dashboard')
  })

  it('429 / outage keep the confirm form with an inline notice', async () => {
    const transport = makeTransport({ confirmPasswordReset: vi.fn().mockRejectedValue(httpErr(429)) })
    const { container } = render(<PasswordResetFlow transport={transport} token="rst" />)
    await fill(container, STRONG, STRONG)
    await userEvent.click(submit(container))
    await waitFor(() => expect(container.querySelector('[data-state="rate-limited"]')).toBeInTheDocument())
    expect(container.querySelector('[data-form="reset-confirm"]')).toBeInTheDocument()
  })

  it('back-to-sign-in uses the SPA handler when given', async () => {
    const onBack = vi.fn()
    const { container } = render(
      <PasswordResetFlow transport={makeTransport()} onBackToSignIn={onBack} />,
    )
    await userEvent.click(container.querySelector('.fzf-vr-foot a')!)
    expect(onBack).toHaveBeenCalled()
  })
})
