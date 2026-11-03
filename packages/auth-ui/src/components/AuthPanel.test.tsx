import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthPanel } from './AuthPanel'
import type { AuthTransport, AuthMethods, AuthenticatedSession, MfaRequiredChallenge } from '../types'

const AUTHENTICATED: AuthenticatedSession = {
  status: 'authenticated',
  token: 'tok-123',
  // Must satisfy the contract's `User` shape. Was `{ id: 'u1' }`, which only
  // compiled while SessionResult.user was `unknown` — the gap this change closes.
  user: { id: 'u1', email: 'u1@example.test', roles: [] },
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
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED, { mode: 'signin', email: 'a@b.com' })
  })

  it('submits signup with the single optional full name only in signup mode (flag OFF = current form)', async () => {
    const transport = makeTransport()
    const onAuthenticated = vi.fn()
    render(
      <AuthPanel variant="compact" mode="signup" transport={transport} onAuthenticated={onAuthenticated} />,
    )

    // ONE name input (autoComplete=name); first/last are gone from the contract (1.0.0).
    expect(screen.getByLabelText('Full name')).toHaveAttribute('autocomplete', 'name')
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!!!!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(transport.signup).toHaveBeenCalledWith({
        email: 'ada@ex.com',
        password: 'S3cret!!!!',
        name: 'Ada Lovelace',
      }),
    )
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED, { mode: 'signup', email: 'ada@ex.com' })
  })

  it('does not render the name field in sign-in mode', () => {
    render(<AuthPanel variant="compact" transport={makeTransport()} onAuthenticated={vi.fn()} />)
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
  })

  it('omits an empty name from the signup request rather than sending ""', async () => {
    const transport = makeTransport()
    render(<AuthPanel variant="compact" mode="signup" transport={transport} onAuthenticated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!!!!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(transport.signup).toHaveBeenCalledWith({ email: 'ada@ex.com', password: 'S3cret!!!!', name: undefined }),
    )
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

  // Regression — "the Google button doesn't show in some cases," reported in
  // prod. The fallback used while getAuthMethods() is in flight — and again if
  // it fails outright — declared `social: []`. The security service's actual
  // default (backend/security/src/routes/security.ts) is Google ENABLED unless
  // SECURITY_SOCIAL_GOOGLE is explicitly 'false', which no deploy env sets. So
  // a slow, unmount-raced, or failed fetch silently hid a button that WAS
  // available. Pins that a failed fetch is no longer indistinguishable from a
  // server that genuinely disabled Google.
  it('still shows the Google button when getAuthMethods() fails outright (fallback matches the real default)', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi.fn().mockRejectedValue(new Error('network error')),
    })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument(),
    )
  })

  it('toggles between sign-in and sign-up labels and clears the name fields context', async () => {
    render(<AuthPanel variant="compact" transport={makeTransport()} onAuthenticated={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
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

  // FFRNT-309 — Facebook sign-up for invitees. The frozen contract's
  // SocialProvider enum is still `google`, so Facebook renders ONLY when the
  // server advertises it (fail-closed hidden otherwise).
  it('shows the Facebook button only when the server advertises it, and starts that provider', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi
        .fn()
        .mockResolvedValue(baseMethods({ social: ['google', 'facebook'] as unknown as AuthMethods['social'] })),
    })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    const fb = await screen.findByRole('button', { name: /sign in with facebook/i })
    expect(fb).toHaveAttribute('data-action', 'social-facebook')
    fireEvent.click(fb)
    await waitFor(() => expect(transport.startSocial).toHaveBeenCalledWith('facebook'))
  })

  it('hides the Facebook button when only Google is advertised', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi.fn().mockResolvedValue(baseMethods({ social: ['google'] })),
    })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    await screen.findByRole('button', { name: /sign in with google/i })
    expect(screen.queryByRole('button', { name: /facebook/i })).not.toBeInTheDocument()
  })

  it('forwards the invitation bindToken on signup and can hide the mode toggle', async () => {
    const transport = makeTransport()
    render(
      <AuthPanel
        variant="compact"
        mode="signup"
        transport={transport}
        onAuthenticated={vi.fn()}
        bindToken="bind_abc"
        hideModeToggle
        emailHint="Use the address this invite was sent to."
      />,
    )
    expect(screen.queryByRole('button', { name: 'Back to sign in' })).not.toBeInTheDocument()
    expect(screen.getByText('Use the address this invite was sent to.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@ex.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!!!!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(transport.signup).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@ex.com', bindToken: 'bind_abc' })),
    )
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

  describe('Forgot password? link (fuzefront.auth.experience)', () => {
    it("is absent by default - flag OFF is today's panel", () => {
      render(<AuthPanel variant="compact" transport={makeTransport()} onAuthenticated={vi.fn()} />)
      expect(screen.queryByRole('link', { name: /forgot password/i })).not.toBeInTheDocument()
    })

    it('renders in sign-in mode when forgotPasswordHref is set, and calls the SPA handler', () => {
      const onForgot = vi.fn()
      render(
        <AuthPanel
          variant="compact"
          transport={makeTransport()}
          onAuthenticated={vi.fn()}
          forgotPasswordHref="/reset"
          onForgotPassword={onForgot}
        />,
      )
      const link = screen.getByRole('link', { name: /forgot password/i })
      expect(link).toHaveAttribute('href', '/reset')
      fireEvent.click(link)
      expect(onForgot).toHaveBeenCalled()
    })

    it('is hidden in sign-up mode', () => {
      render(
        <AuthPanel
          variant="compact"
          mode="signup"
          transport={makeTransport()}
          onAuthenticated={vi.fn()}
          forgotPasswordHref="/reset"
        />,
      )
      expect(screen.queryByRole('link', { name: /forgot password/i })).not.toBeInTheDocument()
    })
  })
})

describe('AuthPanel — fuzefront.auth.experience (both flag states)', () => {
  it('flag OFF (default): signup renders the CURRENT form — no checklist, no confirm field, no experience hooks', () => {
    const { container } = render(
      <AuthPanel variant="compact" mode="signup" transport={makeTransport()} onAuthenticated={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    expect(container.querySelector('[data-form="signup"]')).toBeNull()
    expect(container.querySelector('[data-pwreq]')).toBeNull()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
  })

  it('flag ON: signup renders SignUpFlow (frame hooks) and sign-in is untouched', async () => {
    const transport = makeTransport({ getAuthMethods: vi.fn().mockResolvedValue(baseMethods({ social: ['google'] })), startSocial: vi.fn() })
    const { container } = render(
      <AuthPanel variant="compact" mode="signup" experience transport={transport} onAuthenticated={vi.fn()} />,
    )
    expect(container.querySelector('[data-frame="01-signup"]')).not.toBeNull()
    expect(container.querySelector('[data-form="signup"]')).not.toBeNull()
    expect(container.querySelector('[data-field="full-name"]')).toHaveAttribute('autocomplete', 'name')
    expect(container.querySelector('[data-pwreq]')).not.toBeNull()
    // submit starts disabled until the checklist passes (empty/initial state)
    expect(container.querySelector('[data-action="submit"]')).toBeDisabled()
    await waitFor(() => expect(container.querySelector('[data-action="social-google"]')).not.toBeNull())
  })

  it('flag ON: "Sign in" in the signup experience switches the panel to sign-in mode', async () => {
    render(<AuthPanel variant="compact" mode="signup" experience transport={makeTransport()} onAuthenticated={vi.fn()} />)
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }))
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument()
    expect(document.querySelector('[data-form="signup"]')).toBeNull()
  })

  it('flag ON: an mfa_required sign-in renders the frame mfa-required handoff (title + text)', async () => {
    const transport = makeTransport({ login: vi.fn().mockResolvedValue(MFA_CHALLENGE) })
    render(<AuthPanel variant="compact" experience transport={transport} onAuthenticated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    const note = await screen.findByRole('alert')
    expect(note).toHaveAttribute('data-state', 'mfa-required')
    expect(note).toHaveTextContent('One more step.')
  })

  it('flag OFF: an mfa_required sign-in keeps the current notice copy', async () => {
    const transport = makeTransport({ login: vi.fn().mockResolvedValue(MFA_CHALLENGE) })
    render(<AuthPanel variant="compact" transport={transport} onAuthenticated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/additional verification/i)
  })
})
