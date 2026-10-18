import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FullAccountSecurityClient } from '../../types'
import { err, makeClient, sms, totp } from '../../test/helpers'
import { SecurityStatusMobileFlow } from './SecurityStatus'

const asClient = (c: unknown) => c as Partial<FullAccountSecurityClient>
const q = (sel: string) => document.querySelector(sel)

describe('SecurityStatusMobileFlow (frame 04)', () => {
  it('loading skeleton first', () => {
    render(<SecurityStatusMobileFlow client={asClient(makeClient({ listFactors: vi.fn(() => new Promise(() => {})) }))} />)
    expect(q('[data-panel="security-status"][data-state="loading"]')).toBeTruthy()
  })

  it('loaded: Active factor chips + Verified / Unverified contact chips from CONFIRMED server state', async () => {
    const client = makeClient({
      listFactors: vi.fn(async () => [totp, sms]),
      getVerificationStatus: vi.fn(async () => ({ emailVerified: true, phoneVerified: false })),
    })
    render(<SecurityStatusMobileFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-panel="security-status"][data-state="loaded"]')).toBeTruthy())
    expect(document.querySelectorAll('[data-status="active"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-status="verified"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-status="unverified"]')).toHaveLength(1)
    expect(q('[data-action="verify-phone"]')).toBeTruthy()
    expect(q('[data-action="add-factor"]')).toBeTruthy()
  })

  it('verify-phone and add-factor navigate', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<SecurityStatusMobileFlow client={asClient(makeClient())} onNavigate={onNavigate} />)
    await waitFor(() => expect(q('[data-action="verify-phone"]')).toBeTruthy())
    await user.click(q('[data-action="verify-phone"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/account/security/verify/phone')
    await user.click(q('[data-action="add-factor"]')!)
    expect(onNavigate).toHaveBeenCalledWith('/account/security/mfa/add/authenticator')
  })

  it('a verified phone offers no verify action', async () => {
    const client = makeClient({ getVerificationStatus: vi.fn(async () => ({ emailVerified: true, phoneVerified: true, phone: '+15550004471' })) })
    render(<SecurityStatusMobileFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-panel="security-status"][data-state="loaded"]')).toBeTruthy())
    expect(q('[data-action="verify-phone"]')).toBeNull()
    expect(document.body.textContent).toContain('4471')
  })

  it('error: retry, and NO chips are shown (never a stale guess)', async () => {
    const user = userEvent.setup()
    const listFactors = vi.fn().mockRejectedValueOnce(err(500)).mockResolvedValueOnce([totp])
    render(<SecurityStatusMobileFlow client={asClient(makeClient({ listFactors }))} />)
    await waitFor(() => expect(q('[data-panel="security-status"][data-state="error"]')).toBeTruthy())
    expect(q('[data-status]')).toBeNull()
    await user.click(q('[data-action="retry"]')!)
    await waitFor(() => expect(q('[data-panel="security-status"][data-state="loaded"]')).toBeTruthy())
  })

  it('REMOVE-LAST: 409 shows the bottom-sheet blocked state; the factor stays active (no optimistic removal)', async () => {
    const user = userEvent.setup()
    const client = makeClient({ removeFactor: vi.fn(async () => { throw err(409, 'CONFLICT') }) })
    render(<SecurityStatusMobileFlow client={asClient(client)} />)
    await waitFor(() => expect(q('[data-action="remove-factor"]')).toBeTruthy())
    await user.click(q('[data-action="remove-factor"]')!)
    await user.click(q('[data-action="remove-confirm"]')!)
    await waitFor(() =>
      expect(q('[data-component="remove-factor-dialog"][data-state="remove-last-blocked"][data-http-status="409"]')).toBeTruthy()
    )
    expect(q('[data-error="remove-last"]')).toBeTruthy()
    expect(q('[data-panel="security-status"] [data-factor="totp"] [data-status="active"]')).toBeTruthy()
  })

  it('RTL (he) renders dir=rtl', async () => {
    render(<SecurityStatusMobileFlow client={asClient(makeClient())} locale="he" />)
    expect(q('section[data-frame="04-security-status"]')).toHaveAttribute('dir', 'rtl')
  })

  it('add-method flag ON (default): the "Add a method" button is offered', async () => {
    render(<SecurityStatusMobileFlow client={asClient(makeClient())} />)
    await waitFor(() => expect(q('[data-action="add-factor"]')).toBeTruthy())
    expect(q('[data-state="add-unavailable"]')).toBeNull()
  })

  it('add-method OFF (mfa-management flag OFF): no dead link — an explanation instead', async () => {
    render(<SecurityStatusMobileFlow client={asClient(makeClient())} addMethodEnabled={false} />)
    await waitFor(() => expect(q('[data-panel="security-status"][data-state="loaded"]')).toBeTruthy())
    expect(q('[data-action="add-factor"]')).toBeNull()
    expect(q('[data-state="add-unavailable"]')).toBeTruthy()
  })

  it('add-method OFF: the remove-last blocked sheet offers no "add another" link either', async () => {
    const user = userEvent.setup()
    const client = makeClient({ removeFactor: vi.fn(async () => { throw err(409, 'CONFLICT') }) })
    render(<SecurityStatusMobileFlow client={asClient(client)} addMethodEnabled={false} />)
    await waitFor(() => expect(q('[data-action="remove-factor"]')).toBeTruthy())
    await user.click(q('[data-action="remove-factor"]')!)
    await user.click(q('[data-action="remove-confirm"]')!)
    await waitFor(() => expect(q('[data-component="remove-factor-dialog"][data-state="remove-last-blocked"]')).toBeTruthy())
    expect(q('[data-component="remove-factor-dialog"] [data-action="add-factor"]')).toBeNull()
    expect(q('[data-error="remove-last"]')).toBeTruthy()
  })
})
