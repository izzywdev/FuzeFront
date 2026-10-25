import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FullAccountSecurityClient } from '../../types'
import { err, makeClient, methods, sms, totp } from '../../test/helpers'
import { MfaOverviewFlow } from './MfaOverview'
import { RemoveFactorDialog } from './RemoveFactorDialog'
import { TotpEnrollFlow, buildQrMatrix } from './TotpEnroll'
import { SmsEnrollFlow } from './SmsEnroll'
import { RecoveryCodesFlow } from './RecoveryCodes'

const asClient = (c: unknown) => c as Partial<FullAccountSecurityClient>
const q = (sel: string) => document.querySelector(sel)
/** Server view in which the enrolment's factor is still pending (discard reconciles against it). */
const serverSaysPending = () =>
  vi.fn(async () =>
    ['fct_new', 'fct_sms_1', 'fct_sms_2', 'fct_sms_pending'].map((factorId) => ({ ...totp, factorId, status: 'pending' as const }))
  )
const serverSaysActive = (factorId = 'fct_new') => vi.fn(async () => [{ ...totp, factorId, status: 'active' as const }])

describe('MfaOverviewFlow', () => {
  it('loaded: lists active factors with neutral labels and remove actions', async () => {
    const client = makeClient({
      listFactors: vi.fn(async () => [totp, sms]),
      getMethods: vi.fn(async () => methods(['totp', 'sms'])),
    })
    render(<MfaOverviewFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-panel="mfa-overview"][data-state="loaded"]')).toBeTruthy())
    expect(q('[data-factor="totp"]')).toBeTruthy()
    expect(q('[data-factor="sms"]')?.textContent).toContain('4471')
    expect(document.querySelectorAll('[data-action="remove-factor"]')).toHaveLength(2)
    expect(q('[data-panel="recovery-status"]')).toBeTruthy()
  })

  it('shows the loading skeleton first', () => {
    render(<MfaOverviewFlow client={asClient(makeClient({ listFactors: vi.fn(() => new Promise(() => {})) }))} />)
    expect(q('[data-panel="mfa-overview"][data-state="loading"]')).toBeTruthy()
  })

  it('empty: no factors invites first enrolment and hides recovery status', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<MfaOverviewFlow client={asClient(makeClient({ listFactors: vi.fn(async () => []) }))} onNavigate={onNavigate} />)
    await waitFor(() => expect(q('[data-panel="mfa-overview"][data-state="empty"]')).toBeTruthy())
    expect(q('[data-panel="recovery-status"]')).toBeNull()
    await user.click(q('[data-action="enroll-first"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/account/security/mfa/add/authenticator')
  })

  it('error: offers retry which recovers', async () => {
    const user = userEvent.setup()
    const listFactors = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce([totp])
    render(<MfaOverviewFlow client={asClient(makeClient({ listFactors }))} />)
    await waitFor(() => expect(q('[data-panel="mfa-overview"][data-state="error"]')).toBeTruthy())
    await user.click(q('[data-action="retry"]')!)
    await waitFor(() => expect(q('[data-panel="mfa-overview"][data-state="loaded"]')).toBeTruthy())
  })

  it('HONEST DEGRADE: SMS is offered only when methods.mfa.types includes sms', async () => {
    const { unmount } = render(
      <MfaOverviewFlow client={asClient(makeClient({ getMethods: vi.fn(async () => methods(['totp'])) }))} />
    )
    await waitFor(() => expect(q('[data-add="totp"]')).toBeTruthy())
    expect(q('[data-add="sms"]')).toBeNull()
    unmount()
    render(<MfaOverviewFlow client={asClient(makeClient({ getMethods: vi.fn(async () => methods(['totp', 'sms'])) }))} />)
    await waitFor(() => expect(q('[data-add="sms"]')).toBeTruthy())
  })

  it('pending (unactivated) factors are not shown as methods', async () => {
    const client = makeClient({ listFactors: vi.fn(async () => [{ ...totp, status: 'pending' as const }]) })
    render(<MfaOverviewFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-panel="mfa-overview"][data-state="empty"]')).toBeTruthy())
  })

  it('remove: confirm → DELETE → removed', async () => {
    const user = userEvent.setup()
    const client = makeClient({ listFactors: vi.fn(async () => [totp, sms]), getMethods: vi.fn(async () => methods(['totp', 'sms'])) })
    render(<MfaOverviewFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-factor="sms"]')).toBeTruthy())
    await user.click(within(q('[data-factor="sms"]') as HTMLElement).getByRole('button'))
    expect(q('[data-component="remove-factor-dialog"][data-state="confirm"]')).toBeTruthy()
    await user.click(q('[data-action="remove-confirm"]')!)
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="removed"]')).toBeTruthy())
    expect(client.removeFactor).toHaveBeenCalledWith('fct_sms_1')
  })

  it('DELETE ok but the follow-up reload fails: the removed factor is no longer shown as active', async () => {
    const user = userEvent.setup()
    const listFactors = vi.fn().mockResolvedValueOnce([totp, sms]).mockRejectedValue(err(500))
    const client = makeClient({ listFactors, getMethods: vi.fn(async () => methods(['totp', 'sms'])) })
    render(<MfaOverviewFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-factor="sms"]')).toBeTruthy())
    await user.click(within(q('[data-factor="sms"]') as HTMLElement).getByRole('button'))
    await user.click(q('[data-action="remove-confirm"]')!)
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="removed"]')).toBeTruthy())
    await waitFor(() => expect(listFactors).toHaveBeenCalledTimes(2))
    expect(q('[data-panel="mfa-overview"] [data-factor="sms"]')).toBeNull()
    expect(q('[data-panel="mfa-overview"] [data-factor="totp"]')).toBeTruthy()
  })

  it('REMOVE-LAST: a 409 renders the blocked state, the factor stays, and "add another" routes to enrolment', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const client = makeClient({ removeFactor: vi.fn(async () => { throw err(409, 'LAST_FACTOR') }) })
    render(<MfaOverviewFlow client={asClient(client)} onNavigate={onNavigate} />)
    await waitFor(() => expect(q('[data-factor="totp"]')).toBeTruthy())
    await user.click(q('[data-action="remove-factor"]')!)
    await user.click(q('[data-action="remove-confirm"]')!)
    await waitFor(() =>
      expect(q('[data-component="remove-factor-dialog"][data-state="remove-last-blocked"][data-http-status="409"]')).toBeTruthy()
    )
    expect(q('[data-error="remove-last"]')).toBeTruthy()
    expect(q('[data-component="remove-factor-dialog"][data-state="removed"]')).toBeNull()
    expect(q('[data-panel="mfa-overview"] [data-factor="totp"]')).toBeTruthy()
    await user.click(q('[data-action="add-factor"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/account/security/mfa/add/authenticator')
  })

  it('a non-409 removal failure is a retryable error, not a block', async () => {
    const user = userEvent.setup()
    const removeFactor = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce(undefined)
    render(<MfaOverviewFlow client={asClient(makeClient({ removeFactor }))} />)
    await waitFor(() => expect(q('[data-factor="totp"]')).toBeTruthy())
    await user.click(q('[data-action="remove-factor"]')!)
    await user.click(q('[data-action="remove-confirm"]')!)
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="error"]')).toBeTruthy())
    await user.click(q('[data-component="remove-factor-dialog"] [data-action="retry"]')!)
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="removed"]')).toBeTruthy())
  })

  it('RTL: dir=rtl for he', async () => {
    render(<MfaOverviewFlow client={asClient(makeClient())} locale="he" />)
    expect(document.querySelector('main')).toHaveAttribute('dir', 'rtl')
  })
})

describe('TotpEnrollFlow', () => {
  const start = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /set up authenticator/i }))
    await waitFor(() => expect(q('[data-component="totp-enroll"][data-state="scan"]')).toBeTruthy())
  }

  it('opening the route creates NOTHING: an intro with an explicit start button', () => {
    const client = makeClient()
    render(<TotpEnrollFlow client={asClient(client)} />)
    expect(q('[data-component="totp-enroll"][data-state="intro"]')).toBeTruthy()
    expect(q('[data-action="start-setup"]')).toBeTruthy()
    expect(client.enrollFactor).not.toHaveBeenCalled()
  })

  it('leaving the intro without starting creates and deletes nothing', () => {
    const client = makeClient()
    const { unmount } = render(<TotpEnrollFlow client={asClient(client)} />)
    unmount()
    expect(client.enrollFactor).not.toHaveBeenCalled()
    expect(client.removeFactor).not.toHaveBeenCalled()
  })

  it('Start enrols once and shows QR + setup key + 6-cell OTP', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<TotpEnrollFlow client={asClient(client)} />)
    await start(user)
    expect(client.enrollFactor).toHaveBeenCalledTimes(1)
    expect(client.enrollFactor).toHaveBeenCalledWith({ type: 'totp' })
    expect(q('[data-provisioning-uri]')).toBeTruthy()
    expect(q('svg[role="img"]')).toBeTruthy()
    expect(q('[data-secret]')?.textContent).toBe('JBSW Y3DP EHPK 3PXP')
    expect(document.querySelectorAll('[data-component="otp-input"] input')).toHaveLength(6)
  })

  it('CANCEL deletes the pending factor (best-effort) and navigates back', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const client = makeClient({ listFactors: serverSaysPending() })
    render(<TotpEnrollFlow client={asClient(client)} onNavigate={onNavigate} />)
    await start(user)
    await user.click(q('[data-component="totp-enroll"] [data-action="cancel"]')!)
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalledWith('fct_new'))
    expect(onNavigate).toHaveBeenCalledWith('/account/security/mfa')
  })

  it('UNMOUNT (abandoning the route) deletes the pending factor', async () => {
    const user = userEvent.setup()
    const client = makeClient({ listFactors: serverSaysPending() })
    const { unmount } = render(<TotpEnrollFlow client={asClient(client)} />)
    await start(user)
    unmount()
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalledTimes(1))
    expect(client.removeFactor).toHaveBeenCalledWith('fct_new')
  })

  it('a failing cleanup DELETE never throws or blocks (best-effort)', async () => {
    const user = userEvent.setup()
    const client = makeClient({ listFactors: serverSaysPending(), removeFactor: vi.fn(async () => { throw err(500) }) })
    const { unmount } = render(<TotpEnrollFlow client={asClient(client)} />)
    await start(user)
    expect(() => unmount()).not.toThrow()
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalled())
  })

  describe('unmount while an activation is in flight', () => {
    async function mountAndActivate(activateFactor: ReturnType<typeof vi.fn>, listFactors = serverSaysPending()) {
      const user = userEvent.setup()
      const client = makeClient({ activateFactor, listFactors })
      const view = render(<TotpEnrollFlow client={asClient(client)} onActivated={vi.fn()} />)
      await start(user)
      await user.click(document.querySelector('[data-component="otp-input"] input')!)
      await user.keyboard('492017')
      await user.click(q('[data-action="activate-factor"]')!)
      await waitFor(() => expect(activateFactor).toHaveBeenCalled())
      return { client, view }
    }

    it('activation resolves after unmount → the factor is NOT deleted', async () => {
      let resolve!: (v: unknown) => void
      const activateFactor = vi.fn(() => new Promise((r) => { resolve = r }))
      const { client, view } = await mountAndActivate(activateFactor, serverSaysActive())
      view.unmount()
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled() // not raced against the activation
      await act(async () => { resolve({ factorId: 'fct_new', type: 'totp', status: 'active' }) })
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled()
    })

    it('activation is rejected (wrong code) after unmount → the pending factor is deleted exactly once', async () => {
      let reject!: (e: unknown) => void
      const activateFactor = vi.fn(() => new Promise((_, r) => { reject = r }))
      const { client, view } = await mountAndActivate(activateFactor)
      view.unmount()
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled()
      await act(async () => { reject(err(401, 'NOT_ACTIVE')) })
      await waitFor(() => expect(client.removeFactor).toHaveBeenCalledTimes(1))
      expect(client.removeFactor).toHaveBeenCalledWith('fct_new')
    })

  })

  describe('unmount while the enrolment (CREATE) is still in flight', () => {
    async function startThenUnmount(listFactors: ReturnType<typeof vi.fn>, enrolOutcome: 'resolve' | 'reject') {
      const user = userEvent.setup()
      let settle!: () => void
      const enrollFactor = vi.fn(
        () =>
          new Promise((res, rej) => {
            settle = () =>
              enrolOutcome === 'resolve'
                ? res({ factorId: 'fct_new', type: 'totp', status: 'pending', secret: 'ABCDEFGH', provisioningUri: 'otpauth://totp/x?secret=ABCDEFGH' })
                : rej(err(500, 'BOOM'))
          })
      )
      const client = makeClient({ enrollFactor, listFactors })
      const view = render(<TotpEnrollFlow client={asClient(client)} />)
      await user.click(await screen.findByRole('button', { name: /set up authenticator/i }))
      await waitFor(() => expect(enrollFactor).toHaveBeenCalled())
      view.unmount()
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled()
      await act(async () => { settle() })
      return client
    }

    it('enrol resolves after unmount and the server says pending → deleted exactly once', async () => {
      const client = await startThenUnmount(serverSaysPending(), 'resolve')
      await waitFor(() => expect(client.removeFactor).toHaveBeenCalledTimes(1))
      expect(client.removeFactor).toHaveBeenCalledWith('fct_new')
    })

    it('enrol resolves after unmount but the server says active → NOT deleted', async () => {
      const client = await startThenUnmount(serverSaysActive(), 'resolve')
      await waitFor(() => expect(client.listFactors).toHaveBeenCalled())
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled()
    })

    it('enrol rejects after unmount → no listing, no DELETE', async () => {
      const listFactors = serverSaysPending()
      const client = await startThenUnmount(listFactors, 'reject')
      await act(async () => { await Promise.resolve() })
      expect(listFactors).not.toHaveBeenCalled()
      expect(client.removeFactor).not.toHaveBeenCalled()
    })
  })

  describe('abandon ALWAYS reconciles with the server listing before any DELETE', () => {
    async function activateRejectingThenUnmount(
      rejections: unknown[],
      listFactors: ReturnType<typeof vi.fn>
    ) {
      const user = userEvent.setup()
      const activateFactor = vi.fn()
      for (const e of rejections) activateFactor.mockRejectedValueOnce(e)
      const client = makeClient({ activateFactor, listFactors })
      const view = render(<TotpEnrollFlow client={asClient(client)} />)
      await start(user)
      await user.click(document.querySelector('[data-component="otp-input"] input')!)
      await user.keyboard('492017')
      await user.click(q('[data-action="activate-factor"]')!)
      // Retry through the ambiguous "try again" screen until every rejection is consumed.
      for (let i = 1; i < rejections.length; i++) {
        await waitFor(() => expect(q('[data-state="error"] [data-action="retry"], [data-action="retry"]')).toBeTruthy())
        await user.click(q('[data-action="retry"]')!)
      }
      await waitFor(() => expect(activateFactor).toHaveBeenCalledTimes(rejections.length))
      await waitFor(() => expect(q('[data-state="error"], [data-state="error-invalid"]')).toBeTruthy())
      view.unmount()
      return client
    }

    it('commit lost (503) then a retried code is rejected (401) while the server says ACTIVE → no DELETE', async () => {
      const listFactors = serverSaysActive()
      const client = await activateRejectingThenUnmount([err(503), err(401, 'NOT_ACTIVE')], listFactors)
      expect(client.activateFactor).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(listFactors).toHaveBeenCalled())
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled()
    })

    it('rejected code, server says still PENDING → DELETE exactly once', async () => {
      const client = await activateRejectingThenUnmount([err(401, 'NOT_ACTIVE')], serverSaysPending())
      await waitFor(() => expect(client.removeFactor).toHaveBeenCalledTimes(1))
      expect(client.removeFactor).toHaveBeenCalledWith('fct_new')
    })

    it('the listing fails → no DELETE (left inert)', async () => {
      const listFactors = vi.fn(async () => { throw err(500) })
      const client = await activateRejectingThenUnmount([err(503)], listFactors)
      await waitFor(() => expect(listFactors).toHaveBeenCalled())
      await act(async () => { await Promise.resolve() })
      expect(client.removeFactor).not.toHaveBeenCalled()
    })
  })

  it('an ACTIVATED factor is never deleted on unmount', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    const { unmount } = render(<TotpEnrollFlow client={asClient(client)} onActivated={vi.fn()} />)
    await start(user)
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('492017')
    await user.click(q('[data-action="activate-factor"]')!)
    await waitFor(() => expect(client.activateFactor).toHaveBeenCalled())
    unmount()
    expect(client.removeFactor).not.toHaveBeenCalled()
  })

  it('does not leak the secret into the provisioning attribute', async () => {
    const user = userEvent.setup()
    render(<TotpEnrollFlow client={asClient(makeClient())} />)
    await start(user)
    expect(q('[data-provisioning-uri]')!.getAttribute('data-provisioning-uri')).not.toContain('JBSWY3DP')
  })

  it('activate is disabled until 6 digits; success calls onActivated', async () => {
    const user = userEvent.setup()
    const onActivated = vi.fn()
    const client = makeClient()
    render(<TotpEnrollFlow client={asClient(client)} onActivated={onActivated} />)
    await start(user)
    expect(q('[data-action="activate-factor"]')).toBeDisabled()
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('492017')
    expect(q('[data-action="activate-factor"]')).toBeEnabled()
    await user.click(q('[data-action="activate-factor"]')!)
    await waitFor(() => expect(onActivated).toHaveBeenCalled())
    expect(client.activateFactor).toHaveBeenCalledWith('fct_new', '492017')
  })

  it('FAIL-CLOSED: a wrong code (401) shows the inline error and the factor is not activated', async () => {
    const user = userEvent.setup()
    const onActivated = vi.fn()
    const client = makeClient({ activateFactor: vi.fn(async () => { throw err(401, 'NOT_ACTIVE') }) })
    render(<TotpEnrollFlow client={asClient(client)} onActivated={onActivated} />)
    await start(user)
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('111111')
    await user.click(q('[data-action="activate-factor"]')!)
    await waitFor(() => expect(q('[data-component="totp-enroll"][data-state="error-invalid"]')).toBeTruthy())
    expect(q('[data-error="invalid-code"]')).toBeTruthy()
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('a failed start shows a retryable error (and nothing to clean up)', async () => {
    const user = userEvent.setup()
    const enrollFactor = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce({
      factorId: 'f', type: 'totp', status: 'pending', secret: 'ABCDEFGH', provisioningUri: 'otpauth://totp/x?secret=ABCDEFGH',
    })
    const client = makeClient({ enrollFactor })
    render(<TotpEnrollFlow client={asClient(client)} />)
    await user.click(await screen.findByRole('button', { name: /set up authenticator/i }))
    await waitFor(() => expect(q('[data-state="error"]')).toBeTruthy())
    expect(client.removeFactor).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(q('[data-component="totp-enroll"][data-state="scan"]')).toBeTruthy())
  })

  it('clearing a MIDDLE cell keeps "Turn on" disabled (blank inside a 6-char value is not complete)', async () => {
    const user = userEvent.setup()
    render(<TotpEnrollFlow client={asClient(makeClient())} />)
    await start(user)
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('492017')
    expect(q('[data-action="activate-factor"]')).toBeEnabled()
    await user.click(screen.getByLabelText('digit 3'))
    await user.keyboard('{Backspace}')
    expect(q('[data-action="activate-factor"]')).toBeDisabled()
  })

  it('buildQrMatrix returns a square matrix with finder patterns', () => {
    const m = buildQrMatrix('otpauth://totp/x?secret=ABC')
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((row) => row.length === m.length)).toBe(true)
    expect(m[0][0]).toBe(true)
  })
})

describe('SmsEnrollFlow', () => {
  it('LEADS with channel-unavailable when sms is not in mfa.types: disabled field, NO code sent', async () => {
    const client = makeClient({ getMethods: vi.fn(async () => methods(['totp'])) })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-component="channel-unavailable"][data-available="false"]')).toBeTruthy())
    expect(q('input[type="tel"]')).toBeDisabled()
    expect(q('[data-action="send-code"]')).toBeNull()
    expect(client.enrollFactor).not.toHaveBeenCalled()
  })

  it('unavailable routes the user to the authenticator flow', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<SmsEnrollFlow client={asClient(makeClient())} onNavigate={onNavigate} />)
    await waitFor(() => expect(q('[data-action="use-authenticator"]')).toBeTruthy())
    await user.click(q('[data-action="use-authenticator"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/account/security/mfa/add/authenticator')
  })

  it('a failed capability read fails closed (no phone form)', async () => {
    const client = makeClient({ getMethods: vi.fn(async () => { throw err(500) }) })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-state="error"]')).toBeTruthy())
    expect(q('[data-field="phone"]')).toBeNull()
  })

  it('available: enter phone → send → confirm code → activate', async () => {
    const user = userEvent.setup()
    const onActivated = vi.fn()
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['totp', 'sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: 'fct_sms_new', type: 'sms', status: 'pending', codeSent: true })),
    })
    render(<SmsEnrollFlow client={asClient(client)} onActivated={onActivated} />)
    await waitFor(() => expect(q('[data-component="sms-enroll"][data-state="enter-phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+44 7700 900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="sms-enroll"][data-state="confirm-code"]')).toBeTruthy())
    expect(client.enrollFactor).toHaveBeenCalledWith({ type: 'sms', phone: '+447700900471' })
    expect(screen.getByText(/0471/)).toBeInTheDocument()
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('319028')
    await user.click(q('[data-action="activate-factor"]')!)
    await waitFor(() => expect(onActivated).toHaveBeenCalled())
    expect(client.activateFactor).toHaveBeenCalledWith('fct_sms_new', '319028')
  })

  it('FAIL-CLOSED: wrong / expired code shows the inline error', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: 'f', type: 'sms', status: 'pending', codeSent: true })),
      activateFactor: vi.fn(async () => { throw err(401) }),
    })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="otp-input"]')).toBeTruthy())
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('000000')
    await user.click(q('[data-action="activate-factor"]')!)
    await waitFor(() => expect(q('[data-component="sms-enroll"][data-state="error-invalid"]')).toBeTruthy())
    expect(q('[data-error="invalid-code"]')).toBeTruthy()
  })

  it('a 5xx / network failure on activation is a retryable service error, not "wrong code"', async () => {
    const user = userEvent.setup()
    const activateFactor = vi.fn().mockRejectedValueOnce(err(503)).mockRejectedValueOnce(new TypeError('net'))
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: 'f', type: 'sms', status: 'pending', codeSent: true })),
      activateFactor,
    })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="otp-input"]')).toBeTruthy())
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('123456')
    for (let i = 0; i < 2; i++) {
      await user.click(q('[data-action="activate-factor"]')!)
      await waitFor(() => expect(q('[data-component="sms-enroll"][data-state="error-service"]')).toBeTruthy())
      expect(q('[data-error="service-error"]')).toBeTruthy()
      expect(q('[data-error="invalid-code"]')).toBeNull()
    }
  })

  it('resend is ignored while activation is in flight: the factor being activated is never deleted', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const activateFactor = vi.fn(() => new Promise((r) => { release = () => r({ factorId: 'f', type: 'sms', status: 'active' }) }))
    const enrollFactor = vi.fn(async () => ({ factorId: 'f', type: 'sms', status: 'pending', codeSent: true }))
    const client = makeClient({ getMethods: vi.fn(async () => methods(['sms'])), enrollFactor, activateFactor })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="otp-input"]')).toBeTruthy())
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('123456')
    await user.click(q('[data-action="activate-factor"]')!)
    expect(q('[data-action="resend-code"]')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(q('[data-action="resend-code"]')!)
    expect(enrollFactor).toHaveBeenCalledTimes(1)
    expect(client.removeFactor).not.toHaveBeenCalled()
    await act(async () => { release() })
  })

  it('unmount while the SMS enrolment (CREATE) is in flight: the factor it later creates is deleted once', async () => {
    const user = userEvent.setup()
    let resolve!: (v: unknown) => void
    const enrollFactor = vi.fn(() => new Promise((r) => { resolve = r }))
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor,
      listFactors: serverSaysPending(),
    })
    const view = render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(enrollFactor).toHaveBeenCalled())
    view.unmount()
    await act(async () => { await Promise.resolve() })
    expect(client.removeFactor).not.toHaveBeenCalled()
    await act(async () => { resolve({ factorId: 'fct_sms_pending', type: 'sms', status: 'pending', codeSent: true }) })
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalledTimes(1))
    expect(client.removeFactor).toHaveBeenCalledWith('fct_sms_pending')
  })

  it('unmount during a pending SMS activation: waits for it, keeps the factor on success', async () => {
    const user = userEvent.setup()
    let resolve!: (v: unknown) => void
    const activateFactor = vi.fn(() => new Promise((r) => { resolve = r }))
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: 'f', type: 'sms', status: 'pending', codeSent: true })),
      activateFactor,
    })
    const view = render(<SmsEnrollFlow client={asClient(client)} onActivated={vi.fn()} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="otp-input"]')).toBeTruthy())
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('123456')
    await user.click(q('[data-action="activate-factor"]')!)
    view.unmount()
    await act(async () => { resolve({ factorId: 'f', type: 'sms', status: 'active' }) })
    await act(async () => { await Promise.resolve() })
    expect(client.removeFactor).not.toHaveBeenCalled()
  })

  it('RESEND replaces the pending factor: the previous one is deleted, only the newest is tracked', async () => {
    const user = userEvent.setup()
    let n = 0
    const client = makeClient({
      listFactors: serverSaysPending(),
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: `fct_sms_${++n}`, type: 'sms', status: 'pending', codeSent: true })),
    })
    const { unmount } = render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-action="resend-code"]')).toBeTruthy())
    await user.click(q('[data-action="resend-code"]')!)
    await waitFor(() => expect(client.enrollFactor).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalledWith('fct_sms_1'))
    expect(client.removeFactor).not.toHaveBeenCalledWith('fct_sms_2')
    unmount()
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalledWith('fct_sms_2'))
    expect(client.removeFactor).toHaveBeenCalledTimes(2)
  })

  it('cancel / unmount after sending deletes the pending sms factor (best-effort)', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      listFactors: serverSaysPending(),
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: 'fct_sms_pending', type: 'sms', status: 'pending', codeSent: true })),
    })
    const { unmount } = render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-component="sms-enroll"][data-state="confirm-code"]')).toBeTruthy())
    unmount()
    await waitFor(() => expect(client.removeFactor).toHaveBeenCalledWith('fct_sms_pending'))
  })

  it('formatted input is normalised to E.164; a non-E.164 number keeps Send disabled with a format hint', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => ({ factorId: 'f', type: 'sms', status: 'pending', codeSent: true })),
    })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '5550004471')
    expect(q('[data-action="send-code"]')).toBeDisabled()
    expect(q('[data-hint="phone-format"]')).toBeTruthy()
    await user.clear(q('[data-field="phone"]')!)
    await user.type(q('[data-field="phone"]')!, '+1 (555) 000-4471')
    expect(q('[data-action="send-code"]')).not.toBeDisabled()
    expect(q('[data-hint="phone-format"]')).toBeNull()
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(client.enrollFactor).toHaveBeenCalledWith({ type: 'sms', phone: '+15550004471' }))
  })

  it('after a send failure the number stays editable and can be corrected and re-sent', async () => {
    const user = userEvent.setup()
    const enrollFactor = vi
      .fn()
      .mockRejectedValueOnce(err(400))
      .mockResolvedValueOnce({ factorId: 'f', type: 'sms', status: 'pending', codeSent: true })
    const client = makeClient({ getMethods: vi.fn(async () => methods(['sms'])), enrollFactor })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-state="error-send"]')).toBeTruthy())
    const input = q('[data-field="phone"]') as HTMLInputElement
    expect(input.disabled).toBe(false)
    await user.clear(input)
    await user.type(input, '+447700900999')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(enrollFactor).toHaveBeenLastCalledWith({ type: 'sms', phone: '+447700900999' }))
  })

  it('a send failure stays on the phone step with an error', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      getMethods: vi.fn(async () => methods(['sms'])),
      enrollFactor: vi.fn(async () => { throw err(500) }),
    })
    render(<SmsEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-field="phone"]')).toBeTruthy())
    await user.type(q('[data-field="phone"]')!, '+447700900471')
    await user.click(q('[data-action="send-code"]')!)
    await waitFor(() => expect(q('[data-state="error-send"]')).toBeTruthy())
    expect(q('[data-component="sms-enroll"][data-state="enter-phone"]')).toBeTruthy()
  })
})

describe('RecoveryCodesFlow — REVEAL ONCE', () => {
  const CODES = ['4f2a-9c11', '8b7d-1e04']

  it('lands on STATUS only: nothing is fetched or shown', () => {
    const client = makeClient()
    render(<RecoveryCodesFlow client={asClient(client)} />)
    expect(q('[data-component="recovery-codes"][data-state="status"]')).toBeTruthy()
    expect(q('[data-codes]')).toBeNull()
    expect(client.regenerateRecoveryCodes).not.toHaveBeenCalled()
  })

  it('regenerate needs the acknowledgement; codes are then shown once', async () => {
    const user = userEvent.setup()
    const client = makeClient({ regenerateRecoveryCodes: vi.fn(async () => CODES) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await user.click(q('[data-action="regenerate-open"]')!)
    expect(q('[data-component="recovery-codes"][data-state="regenerate-confirm"]')).toBeTruthy()
    expect(q('[data-action="regenerate-confirm"]')).toBeDisabled()
    await user.click(q('[data-field="ack-invalidate"]')!)
    expect(q('[data-action="regenerate-confirm"]')).toBeEnabled()
    await user.click(q('[data-action="regenerate-confirm"]')!)
    await waitFor(() => expect(q('[data-component="recovery-codes"][data-state="shown-once"]')).toBeTruthy())
    expect(document.querySelectorAll('[data-codes] code')).toHaveLength(2)
    for (const a of ['download-codes', 'copy-codes', 'print-codes']) expect(q(`[data-action="${a}"]`)).toBeTruthy()
    expect(client.regenerateRecoveryCodes).toHaveBeenCalledTimes(1)
  })

  it('dismissing drops the codes from the DOM and they are never re-fetched', async () => {
    const user = userEvent.setup()
    const client = makeClient({ regenerateRecoveryCodes: vi.fn(async () => CODES) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await user.click(q('[data-action="regenerate-open"]')!)
    await user.click(q('[data-field="ack-invalidate"]')!)
    await user.click(q('[data-action="regenerate-confirm"]')!)
    await waitFor(() => expect(q('[data-codes]')).toBeTruthy())
    await user.click(q('[data-action="codes-saved"]')!)
    expect(q('[data-codes]')).toBeNull()
    expect(document.body.textContent).not.toContain('4f2a-9c11')
    expect(client.regenerateRecoveryCodes).toHaveBeenCalledTimes(1)
  })

  it('codes live only in component state: remounting shows STATUS, not the codes', async () => {
    const user = userEvent.setup()
    const client = makeClient({ regenerateRecoveryCodes: vi.fn(async () => CODES) })
    const first = render(<RecoveryCodesFlow client={asClient(client)} />)
    await user.click(q('[data-action="regenerate-open"]')!)
    await user.click(q('[data-field="ack-invalidate"]')!)
    await user.click(q('[data-action="regenerate-confirm"]')!)
    await waitFor(() => expect(q('[data-codes]')).toBeTruthy())
    first.unmount()
    render(<RecoveryCodesFlow client={asClient(client)} />)
    expect(q('[data-component="recovery-codes"][data-state="status"]')).toBeTruthy()
    expect(document.body.textContent).not.toContain('4f2a-9c11')
    expect(client.regenerateRecoveryCodes).toHaveBeenCalledTimes(1)
  })

  it('a failed regeneration reveals NO codes and offers retry', async () => {
    const user = userEvent.setup()
    const client = makeClient({ regenerateRecoveryCodes: vi.fn(async () => { throw err(500) }) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await user.click(q('[data-action="regenerate-open"]')!)
    await user.click(q('[data-field="ack-invalidate"]')!)
    await user.click(q('[data-action="regenerate-confirm"]')!)
    await waitFor(() => expect(q('[data-state="error"]')).toBeTruthy())
    expect(q('[data-component="recovery-codes"][data-state="shown-once"]')).toBeNull()
    expect(q('[data-codes]')).toBeNull()
  })

  it('a failed regeneration does NOT reassure that old codes are unchanged (the response may be lost after commit)', async () => {
    const user = userEvent.setup()
    const client = makeClient({ regenerateRecoveryCodes: vi.fn(async () => { throw err(500) }) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await user.click(q('[data-action="regenerate-open"]')!)
    await user.click(q('[data-field="ack-invalidate"]')!)
    await user.click(q('[data-action="regenerate-confirm"]')!)
    await waitFor(() => expect(q('[data-state="error"]')).toBeTruthy())
    const text = q('[data-state="error"]')!.textContent ?? ''
    expect(text).not.toMatch(/unchanged/i)
    expect(text).toMatch(/may no longer work/i)
  })

  it('status shows "N of M codes left" from the GET and never fetches codes', async () => {
    const client = makeClient({ getRecoveryCodesStatus: vi.fn(async () => ({ remaining: 8, total: 10 })) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    expect(q('[data-state="counts-loading"]')).toBeTruthy()
    await waitFor(() => expect(q('[data-value="recovery-count"]')).toBeTruthy())
    expect(q('[data-value="recovery-count"]')!.textContent).toMatch(/8 of 10 recovery codes left/)
    expect(client.regenerateRecoveryCodes).not.toHaveBeenCalled()
  })

  it('status falls back to the count-less text when no set was ever generated (total 0)', async () => {
    const client = makeClient({ getRecoveryCodesStatus: vi.fn(async () => ({ remaining: 0, total: 0 })) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-state="counts-loading"]')).toBeNull())
    expect(q('[data-value="recovery-count"]')).toBeNull()
    expect(q('[data-component="recovery-codes"][data-state="status"]')!.textContent).toMatch(/never show existing codes/i)
  })

  it('status count failure: explicit error + retry; regenerate stays available', async () => {
    const user = userEvent.setup()
    const getRecoveryCodesStatus = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce({ remaining: 3, total: 10 })
    render(<RecoveryCodesFlow client={asClient(makeClient({ getRecoveryCodesStatus }))} />)
    await waitFor(() => expect(q('[data-state="counts-error"]')).toBeTruthy())
    expect(q('[data-action="regenerate-open"]')).toBeTruthy()
    await user.click(q('[data-action="retry-counts"]')!)
    await waitFor(() => expect(q('[data-value="recovery-count"]')!.textContent).toMatch(/3 of 10/))
  })

  it('re-reads the counts after regenerating (back on status)', async () => {
    const user = userEvent.setup()
    const getRecoveryCodesStatus = vi.fn().mockResolvedValueOnce({ remaining: 2, total: 10 }).mockResolvedValue({ remaining: 10, total: 10 })
    const client = makeClient({ getRecoveryCodesStatus, regenerateRecoveryCodes: vi.fn(async () => CODES) })
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-value="recovery-count"]')!.textContent).toMatch(/2 of 10/))
    await user.click(q('[data-action="regenerate-open"]')!)
    await user.click(q('[data-field="ack-invalidate"]')!)
    await user.click(q('[data-action="regenerate-confirm"]')!)
    await waitFor(() => expect(q('[data-state="shown-once"]')).toBeTruthy())
    await user.click(q('[data-action="codes-saved"]')!)
    await waitFor(() => expect(q('[data-value="recovery-count"]')!.textContent).toMatch(/10 of 10/))
  })

  it('cancel returns to status without calling the server', async () => {
    const user = userEvent.setup()
    const client = makeClient()
    render(<RecoveryCodesFlow client={asClient(client)} />)
    await user.click(q('[data-action="regenerate-open"]')!)
    await user.click(q('[data-action="cancel"]')!)
    expect(q('[data-component="recovery-codes"][data-state="status"]')).toBeTruthy()
    expect(client.regenerateRecoveryCodes).not.toHaveBeenCalled()
  })
})

describe('RemoveFactorDialog — slow DELETE', () => {
  const dialog = (factor: typeof totp, onRemove: () => Promise<void>, onClose = vi.fn(), onRemoved = vi.fn()) => (
    <RemoveFactorDialog factor={factor} otherCount={1} onRemove={onRemove} onClose={onClose} onRemoved={onRemoved} onAddAnother={vi.fn()} />
  )

  it('cannot be dismissed (Escape / backdrop path) while the DELETE is in flight', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const onClose = vi.fn()
    render(dialog(totp, () => new Promise<void>((r) => { release = r }), onClose))
    await user.click(q('[data-action="remove-confirm"]')!)
    expect(q('[data-component="remove-factor-dialog"][data-state="removing"]')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(q('[data-component="remove-factor-dialog"]')).toBeTruthy()
    await act(async () => { release() })
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="removed"]')).toBeTruthy())
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it("a stale completion for factor A never marks factor B 'removed' or shows A's error", async () => {
    const user = userEvent.setup()
    let release!: () => void
    const onRemoved = vi.fn()
    const slowA = () => new Promise<void>((r) => { release = r })
    const view = render(dialog(totp, slowA, vi.fn(), onRemoved))
    await user.click(q('[data-action="remove-confirm"]')!)
    // the parent swaps to factor B while A's DELETE is still pending
    view.rerender(dialog(sms, async () => {}, vi.fn(), onRemoved))
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="confirm"]')).toBeTruthy())
    await act(async () => { release() })
    expect(onRemoved).toHaveBeenCalledWith('fct_totp_1') // truth is reported against A's id
    expect(q('[data-component="remove-factor-dialog"][data-state="confirm"]')).toBeTruthy()
    expect(q('[data-factor-id="fct_sms_1"]')).toBeTruthy()
  })
})
