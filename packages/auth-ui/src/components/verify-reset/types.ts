import type { components } from '@fuzefront/security-client'

/** Contract shape of `POST /v1/security/verify/email/confirm` 200. */
export type VerificationStatus = components['schemas']['VerificationStatus']

/**
 * The injection seam for the verify-email and password-reset flows. Every method
 * maps 1:1 to a frozen contract operation; a non-2xx outcome must reject with an
 * error carrying `status` and/or `code` (axios-style `response.status` /
 * `response.data.code` are also understood — see `classifyAuthError`).
 */
export interface VerifyResetTransport {
  /**
   * POST /v1/security/verify/email/start → 202. Takes NO address: the server
   * derives the target from the authenticated session, so the UI never sends one.
   */
  startEmailVerification(): Promise<void>
  /** POST /v1/security/verify/email/confirm → 200 VerificationStatus | 400 EXPIRED/INVALID_CODE. */
  confirmEmailVerification(req: { token: string }): Promise<VerificationStatus>
  /** POST /v1/security/session/password/reset-request → ALWAYS 202 (no enumeration). */
  requestPasswordReset(email: string): Promise<void>
  /** POST /v1/security/session/password/reset-confirm → 200 {reset:true} | 400. */
  confirmPasswordReset(req: { token: string; newPassword: string }): Promise<void>
}

/** Provider-neutral failure classes the flows render distinct states for. */
export type AuthErrorKind = 'expired' | 'policy' | 'rate-limited' | 'unavailable' | 'unknown'

export interface VerifyResetLabels {
  // check inbox
  checkInboxTitle: string
  checkInboxSent: string
  checkInboxHint: string
  continueToApp: string
  spamNote: string
  resendIn: (time: string) => string
  resendNow: string
  resending: string
  // verify landing
  verifyingTitle: string
  verifyingText: string
  verifiedTitle: string
  verifiedText: string
  continueCta: string
  expiredTitle: string
  expiredText: string
  sendNewLink: string
  signInForNewLink: string
  signInForNewLinkText: string
  newLinkSent: string
  backToSignIn: string
  retry: string
  // reset
  resetRequestTitle: string
  resetRequestText: string
  emailLabel: string
  emailPlaceholder: string
  sendResetLink: string
  sendingResetLink: string
  requestSentTitle: string
  requestSentText: (email: string) => string
  confirmTitle: string
  confirmText: string
  newPasswordLabel: string
  confirmPasswordLabel: string
  updatePassword: string
  updatingPassword: string
  confirmDoneTitle: string
  confirmDoneText: string
  confirmExpiredTitle: string
  confirmExpiredText: string
  requestNewLink: string
  // password helpers
  strengthLabel: string
  strengthWeak: string
  strengthFair: string
  strengthGood: string
  strengthStrong: string
  mismatch: string
  // shared errors
  passwordPolicy: string
  rateLimited: string
  genericError: string
  unavailable: string
}

export const DEFAULT_VERIFY_RESET_LABELS: VerifyResetLabels = {
  checkInboxTitle: 'Check your inbox',
  checkInboxSent: 'We sent a verification link to',
  checkInboxHint:
    'Click the link in that email to activate your account. The link expires in 30 minutes.',
  continueToApp: 'Continue to FuzeFront',
  spamNote:
    "Didn't get it? Check spam, or wait for the timer and resend. You can keep working — we'll ask you to verify before inviting teammates or going live.",
  resendIn: time => `Resend email in ${time}`,
  resendNow: 'Resend email',
  resending: 'Sending…',
  verifyingTitle: 'Verifying your email…',
  verifyingText: 'One moment while we confirm your link.',
  verifiedTitle: 'Email verified',
  verifiedText: "Your account is fully active. You're all set.",
  continueCta: 'Continue to FuzeFront',
  expiredTitle: 'This link has expired',
  expiredText:
    "Verification links are good for 30 minutes. Request a fresh one and we'll send it right over.",
  sendNewLink: 'Send a new link',
  signInForNewLink: 'Sign in to get a new link',
  signInForNewLinkText: 'For your security, sign in first and we will send a fresh verification link.',
  newLinkSent: 'A new verification link is on its way.',
  backToSignIn: 'Back to sign in',
  retry: 'Try again',
  resetRequestTitle: 'Forgot your password?',
  resetRequestText: "Enter your email and we'll send a reset link if an account exists.",
  emailLabel: 'Email',
  emailPlaceholder: 'you@company.com',
  sendResetLink: 'Send reset link',
  sendingResetLink: 'Sending…',
  requestSentTitle: 'Check your email',
  requestSentText: email =>
    `If an account exists for ${email}, a password reset link is on its way. The link expires in 30 minutes.`,
  confirmTitle: 'Set a new password',
  confirmText: "Choose a strong password you don't use anywhere else.",
  newPasswordLabel: 'New password',
  confirmPasswordLabel: 'Confirm new password',
  updatePassword: 'Update password',
  updatingPassword: 'Updating…',
  confirmDoneTitle: 'Password updated',
  confirmDoneText: 'You can now sign in with your new password.',
  confirmExpiredTitle: 'Reset link expired',
  confirmExpiredText: 'This link is no longer valid. Request a new one to continue.',
  requestNewLink: 'Request a new link',
  strengthLabel: 'Password strength',
  strengthWeak: 'Weak',
  strengthFair: 'Fair',
  strengthGood: 'Good',
  strengthStrong: 'Strong',
  mismatch: "Passwords don't match yet.",
  passwordPolicy: 'That password does not meet the password policy. Choose a different one.',
  rateLimited: 'Too many attempts. Please wait a moment before trying again.',
  genericError: 'Something went wrong. Please try again.',
  unavailable: 'The service is temporarily unavailable. Please try again in a moment.',
}
