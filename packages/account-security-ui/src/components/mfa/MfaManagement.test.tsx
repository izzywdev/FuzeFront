import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FullAccountSecurityClient } from '../../types'
import { err, makeClient, methods, sms, totp } from '../../test/helpers'
import { MfaOverviewFlow } from './MfaOverview'
import { TotpEnrollFlow, buildQrMatrix } from './TotpEnroll'
import { SmsEnrollFlow } from './SmsEnroll'
import { RecoveryCodesFlow } from './RecoveryCodes'

const asClient = (c: unknown) => c as Partial<FullAccountSecurityClient>
const q = (sel: string) => document.querySelector(sel)

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

  it('REMOVE-LAST: a 409 renders the blocked state, the factor stays, and "add another" routes to enrolment', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const client = makeClient({ removeFactor: vi.fn(async () => { throw err(409, 'CONFLICT') }) })
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
  it('enrols once and shows QR + setup key + 6-cell OTP', async () => {
    const client = makeClient()
    render(<TotpEnrollFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-component="totp-enroll"][data-state="scan"]')).toBeTruthy())
    expect(client.enrollFactor).toHaveBeenCalledTimes(1)
    expect(client.enrollFactor).toHaveBeenCalledWith({ type: 'totp' })
    expect(q('[data-provisioning-uri]')).toBeTruthy()
    expect(q('svg[role="img"]')).toBeTruthy()
    expect(q('[data-secret]')?.textContent).toBe('JBSW Y3DP EHPK 3PXP')
    expect(document.querySelectorAll('[data-component="otp-input"] input')).toHaveLength(6)
  })

  it('does not leak the secret into the provisioning attribute', async () => {
    render(<TotpEnrollFlow client={asClient(makeClient())} />)
    await waitFor(() => expect(q('[data-provisioning-uri]')).toBeTruthy())
    expect(q('[data-provisioning-uri]')!.getAttribute('data-provisioning-uri')).not.toContain('JBSWY3DP')
  })

  it('activate is disabled until 6 digits; success calls onActivated', async () => {
    const user = userEvent.setup()
    const onActivated = vi.fn()
    const client = makeClient()
    render(<TotpEnrollFlow client={asClient(client)} onActivated={onActivated} />)
    await waitFor(() => expect(q('[data-action="activate-factor"]')).toBeTruthy())
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
    await waitFor(() => expect(q('[data-action="activate-factor"]')).toBeTruthy())
    await user.click(document.querySelector('[data-component="otp-input"] input')!)
    await user.keyboard('111111')
    await user.click(q('[data-action="activate-factor"]')!)
    await waitFor(() => expect(q('[data-component="totp-enroll"][data-state="error-invalid"]')).toBeTruthy())
    expect(q('[data-error="invalid-code"]')).toBeTruthy()
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('a failed start shows a retryable error', async () => {
    const user = userEvent.setup()
    const enrollFactor = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce({
      factorId: 'f', type: 'totp', status: 'pending', secret: 'ABCDEFGH', provisioningUri: 'otpauth://totp/x?secret=ABCDEFGH',
    })
    render(<TotpEnrollFlow client={asClient(makeClient({ enrollFactor }))} />)
    await waitFor(() => expect(q('[data-state="error"]')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(q('[data-component="totp-enroll"]')).toBeTruthy())
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
    expect(client.enrollFactor).toHaveBeenCalledWith({ type: 'sms', phone: '+44 7700 900471' })
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
