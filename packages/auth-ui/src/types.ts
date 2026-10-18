/**
 * Auth contract types — re-exported from the frozen `@fuzefront/security-client`
 * contract (never hand-redefined here). `AuthenticatedSession` and
 * `MfaRequiredChallenge` are the two variants of the generated `SessionResult`
 * discriminated union; the security-client only exports the hand-authored
 * union at the top level, so the variants are derived via `Extract` against
 * that same union rather than reached for separately from `components`.
 */
import type { SessionResult, AuthMethods } from '@fuzefront/security-client'

export type { SessionResult, AuthMethods }

export type AuthenticatedSession = Extract<SessionResult, { status: 'authenticated' }>
export type MfaRequiredChallenge = Extract<SessionResult, { status: 'mfa_required' }>

/** Request shape for a password sign-in. Shape-compatible with the contract's `LoginRequest`. */
export interface LoginRequest {
  email: string
  password: string
}

/** Request shape for account creation. Shape-compatible with the contract's `SignupRequest` (minus `tenantName`, not surfaced by this UI). */
export interface SignupRequest {
  email: string
  password: string
  firstName?: string
  lastName?: string
  /**
   * Single-use invitation bind token (`InvitationEnrollResponse.bindToken`).
   * When present the server verifies the signup identity matches the invited
   * identity and auto-binds the membership as part of signup (FFRNT-309).
   */
  bindToken?: string
}

/**
 * Social providers this panel can render a button for. The frozen contract's
 * `SocialProvider` enum is still `google` only (security-client 0.10.2); Facebook
 * is shown ONLY when the server's `getAuthMethods().social` advertises it, so it
 * stays hidden (fail-closed) until the backend ships the provider.
 */
export type SocialProviderSlug = 'google' | 'facebook'

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
  /** Only called when present — the social buttons are hidden entirely otherwise. */
  startSocial?(provider: SocialProviderSlug): Promise<void>
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
  firstNameLabel: string
  lastNameLabel: string
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
}

export const DEFAULT_AUTH_LABELS: AuthLabels = {
  heading: 'Welcome to FuzeFront',
  signInSubtitle: 'Sign in to access your microfrontend platform',
  signUpSubtitle: 'Create your account to get started',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  firstNameLabel: 'First name',
  lastNameLabel: 'Last name',
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
  /** Called with the established session once sign-in or sign-up succeeds. */
  onAuthenticated: (session: AuthenticatedSession) => void
  /** Called when `login` resolves to an MFA challenge instead of a session. */
  onMfaRequired?: (challenge: MfaRequiredChallenge) => void
  /** Show the Google button. Only rendered when this is true AND `transport.startSocial` is present AND `getAuthMethods()` advertises `google` in `social`. Defaults to `true`. */
  social?: boolean
  /** Override any subset of the default copy. */
  labels?: Partial<AuthLabels>
  /**
   * Invitation bind token (from `POST /invitations/{token}/accept` → `202`).
   * Forwarded on every `transport.signup(...)` so the server auto-binds the
   * invited membership; the panel never interprets it.
   */
  bindToken?: string
  /** Helper text under the email field (e.g. "Use the address this invite was sent to — u***@example.com"). */
  emailHint?: string
  /** Hide the sign-in/sign-up toggle (a dedicated sign-up surface, e.g. invitation accept). */
  hideModeToggle?: boolean
}
