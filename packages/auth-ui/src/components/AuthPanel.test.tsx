import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthPanel } from './AuthPanel'
import type { AuthTransport, AuthMethods, AuthenticatedSession, MfaRequiredChallenge } from '../types'

const AUTHENTICATED: AuthenticatedSession = {
  status: 'authenticated',
  token: 'tok-123',
  user: { id: 'u1' },
}

const MFA_CHALLENGE: MfaRequiredChallenge = {
  status: 'mfa_required',
  challengeId: 'chal-1',
  factors: [{ factorId: 'f1', type: 'totp' }],
}

function baseMethods(overrides: Partial<AuthMethods> = {}): AuthMethods {
  return {
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
    ...overrides,
  }
}

function makeTransport(overrides: Partial<AuthTransport> = {}): AuthTransport {
  return {
    login: vi.fn().mockResolvedValue(AUTHENTICATED),
    signup: vi.fn().mockResolvedValue(AUTHENTICATED),
    getAuthMethods: vi.fn().mockResolvedValue(baseMethods()),
    ...overrides,
  }
}

describe('AuthPanel', () => {
  it('submits sign-in credentials and calls onAuthenticated', async () => {
    const transport = makeTransport()
    const onAuthenticated = vi.fn()
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={onAuthenticated} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() =>
      expect(transport.login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hunter2' }),
    )
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED)
  })

  it('submits signup with first/last name only in signup mode', async () => {
    const transport = makeTransport()
    const onAuthenticated = vi.fn()
    render(
      <AuthPanel variant="compact" mode="signup" transport={transport} onAuthenticated={onAuthenticated} />,
    )

    expect(screen.getByLabelText('First name')).toBeInTheDocument()
    expect(screen.getByLabelText('Last name')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!!!!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(transport.signup).toHaveBeenCalledWith({
        email: 'ada@ex.com',
        password: 'S3cret!!!!',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    )
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED)
  })

  it('does not render first/last name fields in sign-in mode', () => {
    render(<AuthPanel variant="compact" transport={makeTransport()} onAuthenticated={vi.fn()} />)
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument()
  })

  it('surfaces an mfa_required result via onMfaRequired and a notice, without calling onAuthenticated', async () => {
    const transport = makeTransport({ login: vi.fn().mockResolvedValue(MFA_CHALLENGE) })
    const onAuthenticated = vi.fn()
    const onMfaRequired = vi.fn()
    render(
      <AuthPanel
        variant="compact"
        transport={transport}
        onAuthenticated={onAuthenticated}
        onMfaRequired={onMfaRequired}
      />,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(onMfaRequired).toHaveBeenCalledWith(MFA_CHALLENGE))
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/additional verification/i)
  })

  it('shows an error alert when login rejects', async () => {
    const transport = makeTransport({ login: vi.fn().mockRejectedValue(new Error('Incorrect email or password')) })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password'))
  })

  it('hides the Google button when transport has no startSocial, even if methods advertise it', async () => {
    const transport = makeTransport({
      getAuthMethods: vi.fn().mockResolvedValue(baseMethods({ social: ['google'] })),
    })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    await waitFor(() => expect(transport.getAuthMethods).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  it('shows the Google button only when startSocial is present AND methods advertise google', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi.fn().mockResolvedValue(baseMethods({ social: ['google'] })),
    })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    await waitFor(() => expect(transport.startSocial).toHaveBeenCalledWith('google'))
  })

  it('does not render the Google button when startSocial is present but methods do not advertise it', async () => {
    const transport = makeTransport({ startSocial: vi.fn().mockResolvedValue(undefined) })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    await waitFor(() => expect(transport.getAuthMethods).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  it('toggles between sign-in and sign-up labels and clears the name fields context', async () => {
    render(<AuthPanel variant="compact" transport={makeTransport()} onAuthenticated={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByLabelText('First name')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument()
  })

  it('shows per-action pending labels while a submit is in flight', async () => {
    let resolveLogin: (v: AuthenticatedSession) => void = () => {}
    const transport = makeTransport({
      login: vi.fn(() => new Promise<AuthenticatedSession>((resolve) => { resolveLogin = resolve })),
    })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
    resolveLogin(AUTHENTICATED)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeDisabled())
  })

  it('wraps in a CenteredCard for variant="full" (default)', () => {
    const { container } = render(<AuthPanel transport={makeTransport()} onAuthenticated={vi.fn()} />)
    expect(container.querySelector('.fzf-auth-panel')).toBeInTheDocument()
    // CenteredCard renders a full-viewport flex wrapper around the card.
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe('100vh')
  })

  it('applies label overrides', () => {
    render(
      <AuthPanel
        variant="compact"
        transport={makeTransport()}
        onAuthenticated={vi.fn()}
        labels={{ signInCta: 'Enter' }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Enter' })).toBeInTheDocument()
  })
})
