/**
 * Auth copy → i18n. `@fuzefront/auth-ui` never imports an i18n runtime: it takes
 * injected label objects. This module is the one place the host maps every auth
 * label/error onto `frontend/locales/<lng>/common.json` keys (`auth.*`).
 *
 * Every lookup passes the package's own English string as `defaultValue`, so
 *   - a missing key (a locale not yet AI-translated) degrades to English, and
 *   - render paths with no i18n provider (unit tests, the pre-auth shell boot)
 *     still show real copy rather than raw keys.
 * `authI18n.test.ts` asserts the `en` locale and these defaults never drift.
 */
import {
  DEFAULT_AUTH_LABELS,
  DEFAULT_SIGNUP_LABELS,
  type AuthLabels,
  type SignUpLabels,
} from '@fuzefront/auth-ui'

export type TFn = (key: string, options?: Record<string, unknown>) => string

const tr = (t: TFn, key: string, defaultValue: string, vars: Record<string, unknown> = {}) =>
  t(key, { defaultValue, ...vars })

/** SignUpLabels string keys -> locale keys (the function-valued `reqLength` is handled separately). */
export const SIGNUP_LABEL_KEYS: Record<Exclude<keyof SignUpLabels, 'reqLength' | 'turnstileBrand'>, string> = {
  heading: 'auth.signup.heading',
  subtitle: 'auth.signup.subtitle',
  fullNameLabel: 'auth.signup.fullName.label',
  fullNameOptional: 'auth.signup.fullName.optional',
  fullNameHelp: 'auth.signup.fullName.help',
  fullNamePlaceholder: 'auth.signup.fullName.placeholder',
  emailLabel: 'auth.signup.email.label',
  emailPlaceholder: 'auth.signup.email.placeholder',
  availIdleHelp: 'auth.signup.email.avail.help',
  availChecking: 'auth.signup.email.avail.checking',
  availAvailable: 'auth.signup.email.avail.available',
  availTaken: 'auth.signup.email.avail.taken',
  availTakenHelp: 'auth.signup.email.avail.takenHelp',
  availSignInInstead: 'auth.signup.email.avail.signInInstead',
  availError: 'auth.signup.email.avail.error',
  availErrorHelp: 'auth.signup.email.avail.errorHelp',
  passwordLabel: 'auth.signup.password.label',
  showPassword: 'auth.signup.password.show',
  hidePassword: 'auth.signup.password.hide',
  strengthLabel: 'auth.signup.password.strength',
  strengthWeak: 'auth.signup.password.weak',
  strengthFair: 'auth.signup.password.fair',
  strengthGood: 'auth.signup.password.good',
  strengthStrong: 'auth.signup.password.strong',
  reqUpper: 'auth.signup.password.req.upper',
  reqLower: 'auth.signup.password.req.lower',
  reqDigit: 'auth.signup.password.req.digit',
  reqSymbol: 'auth.signup.password.req.symbol',
  reqMet: 'auth.signup.password.req.met',
  reqUnmet: 'auth.signup.password.req.unmet',
  confirmLabel: 'auth.signup.confirm.label',
  confirmMatch: 'auth.signup.confirm.match',
  confirmMismatch: 'auth.signup.confirm.mismatch',
  turnstileLoading: 'auth.signup.turnstile.loading',
  turnstileReady: 'auth.signup.turnstile.ready',
  turnstileVerified: 'auth.signup.turnstile.verified',
  turnstileFailed: 'auth.signup.turnstile.failed',
  turnstileError: 'auth.signup.turnstile.error',
  submit: 'auth.signup.submit',
  submitting: 'auth.signup.submitting',
  orDivider: 'auth.signup.or',
  googleCta: 'auth.signup.google',
  googlePending: 'auth.signup.googlePending',
  haveAccount: 'auth.signup.haveAccount',
  signIn: 'auth.signup.signIn',
  legalPrefix: 'auth.signup.legal.prefix',
  terms: 'auth.signup.legal.terms',
  legalAnd: 'auth.signup.legal.and',
  privacy: 'auth.signup.legal.privacy',
  weakPasswordTitle: 'auth.signup.error.weakPassword.title',
  weakPasswordText: 'auth.signup.error.weakPassword.text',
  conflictTitle: 'auth.signup.error.conflict.title',
  conflictSignIn: 'auth.signup.error.conflict.signIn',
  conflictOr: 'auth.signup.error.conflict.or',
  conflictReset: 'auth.signup.error.conflict.reset',
  unavailableTitle: 'auth.signup.error.unavailable.title',
  unavailableText: 'auth.signup.error.unavailable.text',
  retry: 'auth.signup.error.retry',
  rateLimited: 'auth.signup.error.rateLimited',
  genericError: 'auth.signup.error.generic',
  mfaTitle: 'auth.signup.mfa.title',
  mfaText: 'auth.signup.mfa.text',
  gateTitle: 'auth.gate.title',
  gateTextBefore: 'auth.gate.before',
  gateTextAfter: 'auth.gate.after',
  gateResend: 'auth.gate.resend',
  gateResending: 'auth.gate.resending',
  gateResent: 'auth.gate.resent',
}

export const REQ_LENGTH_KEY = 'auth.signup.password.req.length'

/**
 * Labels for the redesigned signup (`SignUpFlow`). `turnstileBrand` is the
 * challenge vendor's own name (an approved exception to the vendor-name rule) and
 * is deliberately not translated.
 */
export function buildSignupLabels(t: TFn): SignUpLabels {
  const out: Record<string, unknown> = { ...DEFAULT_SIGNUP_LABELS }
  for (const [prop, key] of Object.entries(SIGNUP_LABEL_KEYS)) {
    out[prop] = tr(t, key, (DEFAULT_SIGNUP_LABELS as unknown as Record<string, string>)[prop])
  }
  out.reqLength = (min: number) => tr(t, REQ_LENGTH_KEY, DEFAULT_SIGNUP_LABELS.reqLength(min), { min })
  return out as unknown as SignUpLabels
}

/** AuthLabels prop -> locale key, for the labels the panel renders in BOTH flag states. */
export const AUTH_LABEL_KEYS: Partial<Record<keyof AuthLabels, string>> = {
  heading: 'auth.signin.heading',
  signInSubtitle: 'auth.signin.subtitle',
  signUpSubtitle: 'auth.signin.signUpSubtitle',
  emailLabel: 'auth.signin.email',
  passwordLabel: 'auth.signin.password',
  nameLabel: 'auth.signup.fullName.label',
  signInCta: 'auth.signin.cta',
  signInPending: 'auth.signin.pending',
  signUpCta: 'auth.signup.submit',
  signUpPending: 'auth.signup.submitting',
  googleCta: 'auth.signin.google',
  googlePending: 'auth.signup.googlePending',
  orDivider: 'auth.signup.or',
  toggleToSignInPrompt: 'auth.signup.haveAccount',
  toggleToSignInCta: 'auth.signin.backToSignIn',
  mfaNotice: 'auth.signin.mfaNotice',
  genericError: 'auth.error.generic',
  forgotPassword: 'auth.signin.forgot',
  errorTitle: 'auth.error.title',
  socialStartError: 'auth.error.socialStart',
}

export function buildAuthLabels(t: TFn): Partial<AuthLabels> {
  const out: Partial<Record<keyof AuthLabels, string>> = {}
  for (const [prop, key] of Object.entries(AUTH_LABEL_KEYS) as [keyof AuthLabels, string][]) {
    out[prop] = tr(t, key, DEFAULT_AUTH_LABELS[prop] as string)
  }
  return out as Partial<AuthLabels>
}

/** Sign-in / callback error copy (the taxonomy `mapAuthError` picks from). */
export const AUTH_ERROR_DEFAULTS = {
  timeout: 'Sign-in is taking longer than expected — the service may be busy. Please try again.',
  providerUnavailable:
    'The sign-in service is temporarily unavailable. Your details are fine — please try again in a moment.',
  serviceUnavailable: 'The sign-in service is temporarily unavailable. Please try again in a moment.',
  invalidCredentials: 'Incorrect email or password. Please try again.',
  networkSuffix: ' (Network connection failed — check if the service is running)',
  serverSuffix: ' (Server error — please try again shortly)',
  failed: 'Authentication failed',
  callbackFailed: 'Authentication failed: {{error}}',
  callbackUnexpected: 'Authentication encountered an unexpected error. Please try again.',
  profileLoad: 'Signed in, but failed to load your profile. Please retry.',
  invalidResponse: 'Invalid response from server',
} as const

export type AuthErrorKey = keyof typeof AUTH_ERROR_DEFAULTS

export function authError(t: TFn, key: AuthErrorKey, vars: Record<string, unknown> = {}): string {
  const dv = AUTH_ERROR_DEFAULTS[key].replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
  return t(`auth.error.${key}`, { defaultValue: dv, ...vars })
}
