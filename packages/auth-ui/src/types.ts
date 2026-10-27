/**
 * Auth contract types — re-exported from the frozen `@fuzefront/security-client`
 * contract (never hand-redefined here). `AuthenticatedSession` and
 * `MfaRequiredChallenge` are the two variants of the generated `SessionResult`
 * discriminated union; the security-client only exports the hand-authored
 * union at the top level, so the variants are derived via `Extract` against
 * that same union rather than reached for separately from `components`.
 */
import type { SessionResult, AuthMethods, components } from '@fuzefront/security-client'
import type { SignUpLabels } from './components/signup/labels'

export type { SessionResult, AuthMethods }

/** Authoritative password policy advertised by `GET /v1/security/methods` (`AuthMethods.passwordPolicy`). */
export type PasswordPolicy = NonNullable<AuthMethods['passwordPolicy']>
/** Captcha capability advertised by `GET /v1/security/methods` (`AuthMethods.captcha`). */
export type CaptchaMethod = NonNullable<AuthMethods['captcha']>

export type AuthenticatedSession = Extract<SessionResult, { status: 'authenticated' }>
export type MfaRequiredChallenge = Extract<SessionResult, { status: 'mfa_required' }>

/** Request shape for a password sign-in. Shape-compatible with the contract's `LoginRequest`. */
export interface LoginRequest {
  email: string
  password: string
}

/**
 * Request shape for account creation — DERIVED from the frozen contract's
 * `SignupRequest` (never hand-redefined), restricted to the fields this UI
 * surfaces: `{ email, password, name?, turnstileToken? }`. `firstName`/`lastName`
 * are gone from the contract (1.0.0): a single optional `name` replaces them.
 * (`tenantName` is not surfaced by this UI.) `bindToken` is the single-use
 * invitation carrier (`InvitationEnrollResponse.bindToken`): when present the
 * server verifies the signup identity matches the invited identity and
 * auto-binds the membership as part of signup (org-invitations v2, FFRNT-309).
 */
export type SignupRequest = Pick<
  components['schemas']['SignupRequest'],
  'email' | 'password' | 'name' | 'turnstileToken' | 'bindToken'
>

/**
 * Social providers this panel can render a button for. The frozen contract's
 * `SocialProvider` enum is `google` only; Facebook is shown ONLY when the
 * server's `getAuthMethods().social` advertises it, so it stays hidden
 * (fail-closed) until the backend ships the provider.
 */
export type SocialProviderSlug = 'google' | 'facebook'

/** Result of `GET /v1/security/signup/email-available`. */
export type SignupEmailAvailability = components['schemas']['SignupEmailAvailability']

/**
 * The injection seam between `AuthPanel` and a host app's real transport
 * (HTTP client, mock server, or anything else). `AuthPanel` never imports an
 * HTTP client, routing, or host state directly — every side effect goes
 * through this interface, and every outcome comes back via the component's
 * `onAuthenticated` / `onMfaRequired` callbacks.
 */
export interface AuthTransport {
  login(req: LoginRequest): Promise<SessionResult>
  signup(req: SignupRequest): Promise<AuthenticatedSession>
  getAuthMethods(): Promise<AuthMethods>
  /** Only called when present — the Google button is hidden entirely otherwise. */
  startSocial?(provider: SocialProviderSlug): Promise<void>
  /**
   * `GET /v1/security/signup/email-available?email=` — the debounced inline
   * availability hint on the new signup form. Optional: when absent the field
   * simply shows no availability signal. FAIL-OPEN by contract — a rejection
   * (timeout, 4xx incl. 429, 5xx, network) is rendered as "couldn't check" and
   * NEVER blocks submit; the authoritative duplicate check is `signup` → 409.
   */
  checkEmailAvailable?(email: string, signal?: AbortSignal): Promise<SignupEmailAvailability>
}

/** Which sign-in mode the panel starts in / can toggle to. */
export type AuthPanelMode = 'signin' | 'signup'

/** `full` wraps the form in a `CenteredCard` (a standalone page); `compact` renders just the form (embeddable in a modal/panel). */
export type AuthPanelVariant = 'compact' | 'full'

/** Every user-facing string the panel renders. All overridable via `labels`. */
export interface AuthLabels {
  heading: string
  signInSubtitle: string
  signUpSubtitle: string
  emailLabel: string
  passwordLabel: string
  /** The single optional full-name field (replaces the former first/last pair). */
  nameLabel: string
  signInCta: string
  signInPending: string
  signUpCta: string
  signUpPending: string
  googleCta: string
  googlePending: string
  facebookCta: string
  facebookPending: string
  orDivider: string
  toggleToSignUpPrompt: string
  toggleToSignUpCta: string
  toggleToSignInPrompt: string
  toggleToSignInCta: string
  mfaNotice: string
  genericError: string
  forgotPassword: string
  /** Title of the form-level error alert. */
  errorTitle: string
  /** Fallback when starting the social redirect fails with no message. */
  socialStartError: string
}

export const DEFAULT_AUTH_LABELS: AuthLabels = {
  heading: 'Welcome to FuzeFront',
  signInSubtitle: 'Sign in to access your microfrontend platform',
  signUpSubtitle: 'Create your account to get started',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  nameLabel: 'Full name',
  signInCta: 'Sign In',
  signInPending: 'Signing in…',
  signUpCta: 'Create account',
  signUpPending: 'Creating account…',
  googleCta: 'Sign in with Google',
  googlePending: 'Redirecting to Google…',
  facebookCta: 'Sign in with Facebook',
  facebookPending: 'Redirecting to Facebook…',
  orDivider: 'or',
  toggleToSignUpPrompt: "Don't have an account?",
  toggleToSignUpCta: 'Sign up',
  toggleToSignInPrompt: 'Already have an account?',
  toggleToSignInCta: 'Back to sign in',
  mfaNotice:
    'Additional verification is required to finish signing in. Please complete the verification step to continue.',
  genericError: 'Authentication failed. Please try again.',
  forgotPassword: 'Forgot password?',
  errorTitle: 'Authentication Error',
  socialStartError: 'Failed to start sign-in',
}

/** Context passed alongside the session to `onAuthenticated`. */
export interface AuthenticatedMeta {
  mode: AuthPanelMode
  /** The email the user submitted. */
  email: string
}

/** Which sign-in action is in flight — per-action so only the clicked control shows its own pending label. */
export type PendingAction = 'credentials' | SocialProviderSlug | null

export interface AuthPanelProps {
  /** `full` (default) wraps in `CenteredCard` for a standalone page; `compact` renders just the form. */
  variant?: AuthPanelVariant
  /** Initial mode. Defaults to `signin`. The panel owns mode-toggle state internally. */
  mode?: AuthPanelMode
  /** The injection seam — see `AuthTransport`. */
  transport: AuthTransport
  /**
   * Called with the established session once sign-in or sign-up succeeds. The
   * second argument says which path produced it (and the submitted email), so a
   * host can route a fresh signup to email verification.
   */
  onAuthenticated: (session: AuthenticatedSession, meta?: AuthenticatedMeta) => void
  /** Called when `login` resolves to an MFA challenge instead of a session. */
  onMfaRequired?: (challenge: MfaRequiredChallenge) => void
  /** Show the Google button. Only rendered when this is true AND `transport.startSocial` is present AND `getAuthMethods()` advertises `google` in `social`. Defaults to `true`. */
  social?: boolean
  /**
   * When set, sign-in mode shows a "Forgot password?" link to this href
   * (`fuzefront.auth.experience`). Omit to render no link (today's behaviour).
   */
  forgotPasswordHref?: string
  /** Optional SPA handler for the forgot-password link (the href is still rendered for semantics/middle-click). */
  onForgotPassword?: () => void
  /** Override any subset of the default copy. */
  labels?: Partial<AuthLabels>
  /**
   * Invitation bind token (from `POST /invitations/{token}/accept` → `202`).
   * Forwarded on every legacy-form `transport.signup(...)` so the server
   * auto-binds the invited membership; the panel never interprets it.
   */
  bindToken?: string
  /** Helper text under the email field (e.g. "Use the address this invite was sent to — j***@acme.com"). */
  emailHint?: string
  /** Hide the sign-in/sign-up toggle (a dedicated sign-up surface, e.g. invitation accept). */
  hideModeToggle?: boolean
  /**
   * `fuzefront.auth.experience` — render the NEW signup experience (`SignUpFlow`:
   * optional full name, inline email availability, policy checklist + strength
   * meter, confirm-match, Turnstile, honest error states) in `signup` mode.
   * Default `false`: the current signup form is unchanged. The host resolves the
   * flag (`isAuthExperienceEnabled()` / `useFlag`) and passes the result.
   */
  experience?: boolean
  /** Copy for the new signup experience (only used when `experience` is on). */
  signupLabels?: Partial<SignUpLabels>
  /** Terms / Privacy links shown under the new signup form. The legal line renders only when both are given. */
  termsHref?: string
  privacyHref?: string
  /** Called by the new signup experience's "sign in instead" affordances (409 / taken email). Defaults to switching the panel to sign-in. */
  onSignInInstead?: () => void
  /** href for the 409 card's "reset your password" link. Omit to hide it. */
  resetPasswordHref?: string
}
