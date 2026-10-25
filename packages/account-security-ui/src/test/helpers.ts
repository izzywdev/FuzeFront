import { vi } from 'vitest'
import { HttpError } from '../api/http'
import type { AuthMethods, FullAccountSecurityClient, MfaFactor } from '../types'

/** A strong password that satisfies the DS policy (12+, upper, lower, digit, symbol). */
export const STRONG = 'Correct-Horse-Battery-9!'

export const err = (status: number, code?: string) =>
  new HttpError(status, `HTTP ${status}`, code ? { code } : undefined)

export const methods = (types: AuthMethods['mfa']['types'] = ['totp']): AuthMethods => ({
  password: true,
  social: ['google'],
  mfa: { enabled: types.length > 0, types },
  verification: { email: true, sms: types.includes('sms') },
})

export const totp: MfaFactor = {
  factorId: 'fct_totp_1',
  type: 'totp',
  status: 'active',
  label: 'Authenticator app',
  createdAt: 1781222400000,
}
export const sms: MfaFactor = {
  factorId: 'fct_sms_1',
  type: 'sms',
  status: 'active',
  label: '•••• •• 4471',
}

/**
 * A fully-stubbed client: every method is a vi.fn resolving to a sane default,
 * overridable per test. Typed as the full client so flows accept it directly.
 */
export function makeClient(over: Partial<Record<keyof FullAccountSecurityClient, unknown>> = {}) {
  const base = {
    getConnections: vi.fn(async () => ({ providers: [{ provider: 'google' }], hasPassword: true })),
    getMethods: vi.fn(async () => methods(['totp'])),
    unlinkProvider: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    confirmPasswordReset: vi.fn(async () => {}),
    setPassword: vi.fn(async () => ({ providers: [], hasPassword: true })),
    changePassword: vi.fn(async () => {}),
    listFactors: vi.fn(async () => [totp]),
    enrollFactor: vi.fn(async () => ({
      factorId: 'fct_new',
      type: 'totp',
      status: 'pending',
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/FuzeFront:a@b.co?secret=JBSWY3DPEHPK3PXP&issuer=FuzeFront',
    })),
    activateFactor: vi.fn(async () => ({ ...totp, factorId: 'fct_new' })),
    removeFactor: vi.fn(async () => {}),
    regenerateRecoveryCodes: vi.fn(async () => ['aaaa-1111', 'bbbb-2222']),
    getRecoveryCodesStatus: vi.fn(async () => ({ remaining: 8, total: 10 })),
    challengeMfa: vi.fn(async (challengeId: string, factorId: string) => ({ challengeId, factorId, delivered: true })),
    verifyMfa: vi.fn(async () => ({ token: 'tok', sessionId: 's1' })),
    verifyRecoveryCode: vi.fn(async () => ({ token: 'tok', sessionId: 's1' })),
    startPhoneVerification: vi.fn(async () => {}),
    confirmPhoneVerification: vi.fn(async () => ({ emailVerified: true, phoneVerified: true, phone: '+15550000000' })),
    getVerificationStatus: vi.fn(async () => ({ emailVerified: true, phoneVerified: false })),
  }
  return { ...base, ...over } as typeof base & Partial<FullAccountSecurityClient>
}
