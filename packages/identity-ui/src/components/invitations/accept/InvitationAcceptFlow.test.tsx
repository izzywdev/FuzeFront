import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { InvitationAcceptFlow, type InvitationAcceptFlowProps } from './InvitationAcceptFlow'
import { fakeClient, http, renderI18n, resolved } from '../testkit'

function setup(over: Partial<InvitationAcceptFlowProps> = {}, client = fakeClient()) {
  const props: InvitationAcceptFlowProps = {
    token: 'tok_abc',
    client,
    session: null,
    onSignIn: vi.fn(),
    onGoToOrg: vi.fn(),
    renderSignup: ({ bindToken, onSignedUp }) => (
      <div data-testid="signup-slot" data-bind-token={bindToken}>
        <button onClick={onSignedUp}>finish sign-up</button>
      </div>
    ),
    ...over,
  }
  renderI18n(<InvitationAcceptFlow {...props} />)
  return { props, client }
}

const state = (s: string) => document.querySelector(`[data-state="${s}"]`)

describe('InvitationAcceptFlow', () => {
  it('resolves server-side and shows org, role and member type from the preview (never client state)', async () => {
    const { client } = setup()
    expect(document.querySelector('[data-state="loading"]')).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByRole('heading', { name: 'Northwind' })).toBeInTheDocument()
    expect(client.resolve).toHaveBeenCalledWith('tok_abc')
    const summary = document.querySelector('[data-panel="invite-summary"]') as HTMLElement
    expect(summary.querySelector('[data-value="role"]')).toHaveTextContent(/admin/i)
    expect(summary.querySelector('[data-value="member-type"]')).toHaveTextContent('Employee')
    expect(summary.querySelector('[data-value="invite-email"]')).toHaveTextContent('j***@acme.com')
  })

  it('closes the token-drop gap: anonymous accept -> 202 -> sign-up slot receives the bindToken', async () => {
    const accept = vi.fn().mockResolvedValue({ action: 'enroll', enrollUrl: 'https://x/enroll', bindToken: 'bind_123' })
    const onEnroll = vi.fn()
    setup({ onEnroll }, fakeClient({ accept }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create account & accept' }))
    const slot = await screen.findByTestId('signup-slot')
    expect(slot).toHaveAttribute('data-bind-token', 'bind_123')
    expect(onEnroll).toHaveBeenCalledWith({ token: 'tok_abc', bindToken: 'bind_123' })
    expect(document.querySelector('[data-panel="accept-signup"]')).toBeInTheDocument()
  })

  it('auto-binds after sign-up: a 409 right after sign-up is the bind already done -> bound success', async () => {
    const accept = vi
      .fn()
      .mockResolvedValueOnce({ action: 'enroll', enrollUrl: 'https://x', bindToken: 'bind_123' })
      .mockRejectedValueOnce(http(409))
    const { props } = setup({ session: null }, fakeClient({ accept }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create account & accept' }))
    fireEvent.click(await screen.findByRole('button', { name: 'finish sign-up' }))
    await waitFor(() => expect(state('bound')).toBeInTheDocument())
    expect(document.querySelector('[data-panel="bind-success"] [data-value="org"]')).toHaveTextContent('Northwind')
    fireEvent.click(screen.getByRole('button', { name: /go to northwind/i }))
    expect(props.onGoToOrg).toHaveBeenCalledWith('org_1')
  })

  it('anonymous "sign in to accept" hands off to the host', async () => {
    const { props } = setup()
    fireEvent.click(await screen.findByRole('button', { name: /already have an account/i }))
    expect(props.onSignIn).toHaveBeenCalled()
  })

  it('authenticated: a single Accept CTA binds and shows the returned role + member type', async () => {
    const accept = vi.fn().mockResolvedValue({
      action: 'bound',
      organizationId: 'org_1',
      userId: 'usr_me',
      role: 'viewer',
      memberType: 'customer',
    })
    const onBound = vi.fn()
    setup({ session: { email: 'jordan@acme.com' }, onBound }, fakeClient({ accept }))
    expect(screen.queryByRole('button', { name: 'Create account & accept' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    await waitFor(() => expect(state('bound')).toBeInTheDocument())
    expect(document.querySelector('[data-panel="bind-success"] [data-value="member-type"]')).toHaveTextContent('Customer')
    expect(document.querySelector('[data-panel="bind-success"] [data-value="account"]')).toHaveTextContent('jordan@acme.com')
    expect(onBound).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_1', role: 'viewer' }))
  })

  it('autoAccept binds once on return (sign-up / social) without a click', async () => {
    const { client } = setup({ session: { email: 'jordan@acme.com' }, autoAccept: true })
    await waitFor(() => expect(state('bound')).toBeInTheDocument())
    expect(client.accept).toHaveBeenCalledTimes(1)
  })

  it('403 renders the identity mismatch naming both identities, with switch-account', async () => {
    const { props } = setup(
      { session: { email: 'sam@globex.io' }, onSwitchAccount: vi.fn() },
      fakeClient({ accept: vi.fn().mockRejectedValue(http(403)) }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    const card = await waitFor(() => {
      const el = state('identity-mismatch')
      expect(el).toBeInTheDocument()
      return el as HTMLElement
    })
    expect(card).toHaveAttribute('data-http', '403')
    expect(card).toHaveAttribute('data-error-code', 'IDENTITY_MISMATCH')
    expect(card).toHaveTextContent('sam@globex.io')
    expect(card).toHaveTextContent('j***@acme.com')
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }))
    expect(props.onSwitchAccount).toHaveBeenCalled()
  })

  it('409 on a plain accept is success-equivalent: already joined, with go-to-org', async () => {
    const { props } = setup(
      { session: { email: 'jordan@acme.com' } },
      fakeClient({ accept: vi.fn().mockRejectedValue(http(409)) }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    const card = await waitFor(() => {
      const el = state('already-accepted')
      expect(el).toBeInTheDocument()
      return el as HTMLElement
    })
    expect(card).toHaveAttribute('data-error-code', 'INVITATION_ALREADY_ACCEPTED')
    fireEvent.click(screen.getByRole('button', { name: /go to northwind/i }))
    expect(props.onGoToOrg).toHaveBeenCalledWith('org_1')
  })

  it('410 on resolve renders the expired/revoked card', async () => {
    setup({}, fakeClient({ resolve: vi.fn().mockRejectedValue(http(410)) }))
    const card = await waitFor(() => {
      const el = state('token-invalid')
      expect(el).toBeInTheDocument()
      return el as HTMLElement
    })
    expect(card).toHaveAttribute('data-http', '410')
    expect(card).toHaveAttribute('data-error-code', 'INVITATION_EXPIRED')
  })

  it('treats a resolved revoked/expired/accepted status as fail-closed', async () => {
    setup({}, fakeClient({ resolve: vi.fn().mockResolvedValue(resolved({ status: 'revoked' })) }))
    await waitFor(() => expect(state('token-invalid')).toBeInTheDocument())
  })

  it('404 renders not-found; nothing sensitive leaks', async () => {
    setup({}, fakeClient({ resolve: vi.fn().mockRejectedValue(http(404)) }))
    await waitFor(() => expect(state('not-found')).toBeInTheDocument())
  })

  it('localizes to Hebrew', async () => {
    renderI18n(
      <InvitationAcceptFlow
        token="t"
        client={fakeClient()}
        session={null}
        onSignIn={vi.fn()}
        onGoToOrg={vi.fn()}
        renderSignup={() => null}
      />,
      'he',
    )
    expect(await screen.findByRole('button', { name: 'יצירת חשבון וקבלה' })).toBeInTheDocument()
  })
})
