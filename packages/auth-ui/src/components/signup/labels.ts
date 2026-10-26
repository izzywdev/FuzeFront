/**
 * Every user-facing string of the new signup experience (`SignUpFlow` and its
 * field components). The package never imports an i18n runtime: the host builds
 * this from its `t()` (keys are `auth.signup.*` — see `frontend/locales/*`) and
 * passes it down, exactly like `AuthLabels` / `VerifyResetLabels`. English
 * defaults below are the reference strings from the approved frames.
 */
export interface SignUpLabels {
  heading: string
  subtitle: string

  // full name (ONE optional field — replaces first/last)
  fullNameLabel: string
  fullNameOptional: string
  fullNameHelp: string
  fullNamePlaceholder: string

  // email + inline availability
  emailLabel: string
  emailPlaceholder: string
  availIdleHelp: string
  availChecking: string
  availAvailable: string
  availTaken: string
  availTakenHelp: string
  availSignInInstead: string
  availError: string
  availErrorHelp: string

  // password + strength + checklist
  passwordLabel: string
  showPassword: string
  hidePassword: string
  strengthLabel: string
  strengthWeak: string
  strengthFair: string
  strengthGood: string
  strengthStrong: string
  /** "12+ characters" — receives the policy's minimum length. */
  reqLength: (min: number) => string
  reqUpper: string
  reqLower: string
  reqDigit: string
  reqSymbol: string
  reqMet: string
  reqUnmet: string

  // confirm
  confirmLabel: string
  confirmMatch: string
  confirmMismatch: string

  // turnstile
  turnstileLoading: string
  turnstileReady: string
  turnstileVerified: string
  turnstileFailed: string
  turnstileError: string
  turnstileBrand: string

  // actions
  submit: string
  submitting: string
  orDivider: string
  googleCta: string
  googlePending: string
  haveAccount: string
  signIn: string
  legalPrefix: string
  terms: string
  legalAnd: string
  privacy: string

  // states
  weakPasswordTitle: string
  weakPasswordText: string
  conflictTitle: string
  conflictSignIn: string
  conflictOr: string
  conflictReset: string
  unavailableTitle: string
  unavailableText: string
  retry: string
  rateLimited: string
  genericError: string
  mfaTitle: string
  mfaText: string

  // verify-to-continue gate (unverified account)
  gateTitle: string
  gateTextBefore: string
  gateTextAfter: string
  gateResend: string
  gateResending: string
  gateResent: string
}

export const DEFAULT_SIGNUP_LABELS: SignUpLabels = {
  heading: 'Create your account',
  subtitle: 'Start your workspace in a minute. No credit card required.',

  fullNameLabel: 'Full name',
  fullNameOptional: 'optional',
  fullNameHelp:
    'How your name appears across FuzeFront. Any script, in your own order — you can add or change it later.',
  fullNamePlaceholder: 'Ada Lovelace',

  emailLabel: 'Work email',
  emailPlaceholder: 'you@company.com',
  availIdleHelp: "We'll check availability as you type.",
  availChecking: 'Checking…',
  availAvailable: 'Available',
  availTaken: 'Already registered',
  availTakenHelp: 'That email has an account.',
  availSignInInstead: 'Sign in instead?',
  availError: "Couldn't check right now",
  availErrorHelp: "We'll confirm when you submit — this never blocks you from trying.",

  passwordLabel: 'Password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  strengthLabel: 'Password strength',
  strengthWeak: 'Weak',
  strengthFair: 'Fair',
  strengthGood: 'Good',
  strengthStrong: 'Strong',
  reqLength: min => `${min}+ characters`,
  reqUpper: 'Uppercase letter',
  reqLower: 'Lowercase letter',
  reqDigit: 'Number',
  reqSymbol: 'Symbol',
  reqMet: ' — met',
  reqUnmet: ' — not met',

  confirmLabel: 'Confirm password',
  confirmMatch: 'Passwords match.',
  confirmMismatch: "Passwords don't match yet.",

  turnstileLoading: 'Loading challenge…',
  turnstileReady: 'Complete the challenge',
  turnstileVerified: "Verified — you're human",
  turnstileFailed: 'Verification failed',
  turnstileError: 'Please complete the challenge to continue.',
  turnstileBrand: 'Cloudflare Turnstile',

  submit: 'Create account',
  submitting: 'Creating account…',
  orDivider: 'or',
  googleCta: 'Continue with Google',
  googlePending: 'Redirecting to Google…',
  haveAccount: 'Already have an account?',
  signIn: 'Sign in',
  legalPrefix: 'By creating an account you agree to our',
  terms: 'Terms',
  legalAnd: 'and',
  privacy: 'Privacy Policy',

  weakPasswordTitle: "That password doesn't meet our requirements.",
  weakPasswordText: 'Fix the highlighted items and try again.',
  conflictTitle: 'That account already exists.',
  conflictSignIn: 'Sign in',
  conflictOr: 'or',
  conflictReset: 'reset your password',
  unavailableTitle: "We couldn't create your account right now.",
  unavailableText: 'Sign-up is temporarily unavailable — continue in your browser or try again shortly.',
  retry: 'Try again',
  rateLimited: 'Too many attempts. Please wait a moment before trying again.',
  genericError: 'Something went wrong creating your account. Please try again.',
  mfaTitle: 'One more step.',
  mfaText: 'This account uses two-factor authentication — continue with the verification challenge.',

  gateTitle: 'Verify your email to continue',
  gateTextBefore: 'Confirm',
  gateTextAfter: 'before inviting teammates or going live.',
  gateResend: 'Resend link',
  gateResending: 'Sending…',
  gateResent: 'A new link is on its way.',
}
