/**
 * UnverifiedGate — the `unverified-gate` frame state, behind fuzefront.auth.experience.
 * Both flag states + fail-open behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { AuthMethods } from '@fuzefront/security-client'
import { UnverifiedGate } from '../components/UnverifiedGate'
import { authAPI } from '../services/api'

const METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: true, sms: false },
}

function setFlag(on: boolean | undefined) {
  const w = window as unknown as { __FF_AUTH_EXPERIENCE__?: boolean }
  if (on === undefined) delete w.__FF_AUTH_EXPERIENCE__
  else w.__FF_AUTH_EXPERIENCE__ = on
}

describe('UnverifiedGate', () => {
  beforeEach(() => {
    vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue(METHODS)
  })
  afterEach(() => {
    setFlag(undefined)
    vi.restoreAllMocks()
  })

  it('flag OFF (default): renders nothing and makes no request', async () => {
    const status = vi.spyOn(authAPI, 'getVerificationStatus')
    const { container } = render(<UnverifiedGate email="ada@lovelace.io" />)
    await new Promise(r => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
    expect(authAPI.getAuthMethods).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  })

  describe('flag ON', () => {
    beforeEach(() => setFlag(true))

    it('shows the gate banner for an unverified account and resends via POST /verify/email/start', async () => {
      vi.spyOn(authAPI, 'getVerificationStatus').mockResolvedValue({ emailVerified: false, phoneVerified: false })
      const start = vi.spyOn(authAPI, 'startEmailVerification').mockResolvedValue(undefined)
      render(<UnverifiedGate email="ada@lovelace.io" />)
      const banner = await waitFor(() => {
        const el = document.querySelector('[data-state="unverified-gate"]')
        expect(el).not.toBeNull()
        return el as HTMLElement
      })
      expect(banner).toHaveTextContent('Verify your email to continue')
      expect(banner).toHaveTextContent('ada@lovelace.io')
      fireEvent.click(banner.querySelector('[data-action="resend"]')!)
      await waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    })

    it('renders nothing for a verified account', async () => {
      vi.spyOn(authAPI, 'getVerificationStatus').mockResolvedValue({ emailVerified: true, phoneVerified: false })
      const { container } = render(<UnverifiedGate email="ada@lovelace.io" />)
      await waitFor(() => expect(authAPI.getVerificationStatus).toHaveBeenCalled())
      expect(container).toBeEmptyDOMElement()
    })

    it('does not ask for status when the platform does not verify email', async () => {
      vi.spyOn(authAPI, 'getAuthMethods').mockResolvedValue({ ...METHODS, verification: { email: false, sms: false } })
      const status = vi.spyOn(authAPI, 'getVerificationStatus')
      const { container } = render(<UnverifiedGate email="ada@lovelace.io" />)
      await waitFor(() => expect(authAPI.getAuthMethods).toHaveBeenCalled())
      expect(status).not.toHaveBeenCalled()
      expect(container).toBeEmptyDOMElement()
    })

    it('FAILS OPEN: a status error shows no banner', async () => {
      vi.spyOn(authAPI, 'getVerificationStatus').mockRejectedValue(new Error('boom'))
      const { container } = render(<UnverifiedGate email="ada@lovelace.io" />)
      await waitFor(() => expect(authAPI.getVerificationStatus).toHaveBeenCalled())
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('renders nothing (and asks nothing) until the user email is known', async () => {
      const { container } = render(<UnverifiedGate />)
      await new Promise(r => setTimeout(r, 20))
      expect(container).toBeEmptyDOMElement()
      expect(authAPI.getAuthMethods).not.toHaveBeenCalled()
    })
  })
})
