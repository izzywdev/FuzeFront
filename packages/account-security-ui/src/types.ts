/**
 * Contract-bound types for the account-security hub.
 *
 * `AuthMethods`, `SocialProvider`, and `ErrorBody` are imported from the frozen
 * `@fuzefront/security-client` so drift is a compile error.
 *
 * ⚠️ CONTRACT-CLIENT GAP (for contract-designer / backend-engineer):
 * `openapi.yaml` defines `IdentityConnections` + `SocialConnection`
 * (GET /v1/security/identity/connections), but the PUBLISHED
 * `@fuzefront/security-client` (v0.2.0) exposes NEITHER — its `generated.ts`
 * and hand-authored `types.ts` predate those schemas. The client must be
 * REGENERATED from the frozen spec and re-published so these types come from
 * the client, not this package. Until then they are mirrored here EXACTLY from
 * the frozen openapi.yaml (`components.schemas.IdentityConnections` /
 * `SocialConnection`). This is the only hand-mirrored surface; remove it once
 * the client is regenerated.
 */
import type { AuthMethods as ClientAuthMethods, SocialProvider as ClientSocialProvider } from '@fuzefront/security-client'
import type { components } from '@fuzefront/security-client'

/** Neutral auth capability descriptor (drives which affordances render). */
export type AuthMethods = ClientAuthMethods
/** Supported social provider slug (extensible; `google` first). */
export type SocialProvider = ClientSocialProvider
/** Stable, provider-neutral error body. */
export type ErrorBody = components['schemas']['ErrorBody']

/**
 * A linked social sign-in connection. Mirrors `openapi.yaml`
 * `components.schemas.SocialConnection` (move to the client once regenerated).
 */
export interface SocialConnection {
  provider: SocialProvider
  /** Epoch millis when the provider was linked. */
  linkedAt?: number
}

/**
 * Result of beginning a social-link handshake. Mirrors `openapi.yaml`
 * `components.schemas.SocialLinkStart` (POST /v1/security/social/{provider}/link).
 * The SPA navigates the browser to `redirectUrl`; no vendor UI is ever rendered
 * by FuzeFront itself.
 */
export interface SocialLinkStart {
  redirectUrl: string
}

/**
 * The account's sign-in connections: linked social providers + whether a
 * password sign-in method exists. Mirrors `openapi.yaml`
 * `components.schemas.IdentityConnections` (move to the client once regenerated).
 */
export interface IdentityConnections {
  providers: SocialConnection[]
  hasPassword: boolean
}

/** Which hub card a navigation targets. Mirrors the frame `data-route`s. */
export type SecurityCardKey =
  | 'password'
  | 'two-factor'
  | 'sessions'
  | 'tokens'
  | 'connected'

/** Overall posture derived from connections + methods. Never a vendor name. */
export type PostureLevel = 'good' | 'attention'

/**
 * The data the hub renders, assembled from GET /identity/connections + /methods.
 * Fields with no backing endpoint yet render an honest "unknown" state rather
 * than fabricated values.
 */
export interface SecurityOverview {
  connections: IdentityConnections
  methods: AuthMethods
  /**
   * Active-device count from GET /v1/security/sessions when available. `null`
   * means "not loaded here" — the hub renders an honest unknown, never a fake 0.
   */
  activeSessions: number | null
  /**
   * Active API-token count. No backing count endpoint exists on the Security
   * contract yet, so this is `null` (honest unknown) until one is added.
   */
  activeTokens: number | null
}

/** Client for the read + fail-closed-mutation surface the hub touches. */
export interface AccountSecurityClient {
  getConnections(): Promise<IdentityConnections>
  getMethods(): Promise<AuthMethods>
  /** Optional: active-session count for the devices card. */
  getActiveSessionCount?(): Promise<number>
  /**
   * Unlink a social provider. Fail-closed: unlinking the account's LAST
   * sign-in method rejects with an HttpError(409) rather than succeeding —
   * callers (SignInMethodsList) surface the last-sign-in-method guard.
   */
  unlinkProvider(provider: SocialConnection['provider']): Promise<void>
  /**
   * Begin linking a social provider (`POST /v1/security/social/{provider}/link`).
   * Returns `{ redirectUrl }` for the caller to navigate the browser to — no
   * vendor UI is ever rendered by FuzeFront itself. Fail-closed: rejects with
   * HttpError(409) when the provider is already linked (surfaced as the
   * `already-linked` state by ConnectedAccountsPanel).
   *
   * Optional so existing `AccountSecurityClient` test doubles (the hub, which
   * doesn't offer connect) don't need to implement it.
   */
  linkProvider?(provider: SocialConnection['provider']): Promise<SocialLinkStart>
  /**
   * Set/add a password on a social-only account (`POST /v1/security/password`).
   * Rejects with HttpError(409) if a password already exists. Optional for the
   * same reason as `linkProvider`.
   */
  setPassword?(newPassword: string): Promise<IdentityConnections>
}

// ---------------------------------------------------------------------------
// Password reset / change (FFRNT-140) — frames: design/frames/password-reset
// ---------------------------------------------------------------------------

/**
 * Password operations. `requestPasswordReset` / `confirmPasswordReset` /
 * `setPassword` are in the frozen contract. `changePassword` is
 * `POST /v1/security/password/change` (backend #1555): 204 | 400 INVALID_CREDENTIALS
 * (wrong current) | 422 PASSWORD_POLICY | 409 NO_PASSWORD (set one instead).
 */
export interface PasswordClient {
  /** `POST /v1/security/session/password/reset-request` — always 202. */
  requestPasswordReset(email: string): Promise<void>
  /** `POST /v1/security/session/password/reset-confirm` — 200 `{reset:true}` | 400. */
  confirmPasswordReset(token: string, newPassword: string): Promise<void>
  /** `POST /v1/security/password` — 200 | 409 (one exists) | 400 (policy). */
  setPassword(newPassword: string): Promise<IdentityConnections>
  /** `POST /v1/security/password/change` — see interface docs. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>
}

// ---------------------------------------------------------------------------
// MFA (FFRNT-141 / FFRNT-362) — frames: design/frames/mfa-management, mfa-stepup-mobile
// ---------------------------------------------------------------------------

/** Factor kinds (contract `MfaFactorType`). */
export type MfaFactorType = components['schemas']['MfaFactorType']
/** An enrolled / pending factor (contract `MfaFactor`). `label` is a neutral hint. */
export type MfaFactor = components['schemas']['MfaFactor']
/** Enrolment material (contract `MfaEnrollResult`). */
export type MfaEnrollResult = components['schemas']['MfaEnrollResult']
/** Minimal factor reference offered in a step-up challenge. */
export interface MfaFactorRef {
  factorId: string
  type: MfaFactorType
}
/** Recovery-code proof for `POST /mfa/verify` (contract `MfaRecoveryVerifyRequest`, a `MfaVerifyRequest` variant). */
export type MfaRecoveryVerifyRequest = components['schemas']['MfaRecoveryVerifyRequest']
/** Status of the current recovery-code set (contract `RecoveryCodesStatus`) — counts only, never codes. */
export type RecoveryCodesStatusResult = components['schemas']['RecoveryCodesStatus']
/** Ack of `POST /mfa/challenge` (contract `MfaChallengeAck`). */
export type MfaChallengeAck = components['schemas']['MfaChallengeAck']
/** Contact-verification state (contract `VerificationStatus`). */
export interface VerificationStatus {
  emailVerified: boolean
  phoneVerified: boolean
  phone?: string
}
/** Session minted by a successful step-up (`POST /mfa/verify` 200). */
export interface MfaSession {
  token: string
  sessionId?: string
  user?: unknown
}

/** Factor management (authenticated). */
export interface MfaClient {
  getMethods(): Promise<AuthMethods>
  /** `GET /v1/security/mfa/factors` → `{ items }`. */
  listFactors(): Promise<MfaFactor[]>
  /** `POST /v1/security/mfa/factors` → 201. */
  enrollFactor(req: { type: MfaFactorType; phone?: string; email?: string }): Promise<MfaEnrollResult>
  /** `POST /v1/security/mfa/factors/{id}/activate` — wrong code rejects (401/400). */
  activateFactor(factorId: string, code: string): Promise<MfaFactor>
  /** `DELETE /v1/security/mfa/factors/{id}` — 204; 409 when it is the only factor under enforced MFA. */
  removeFactor(factorId: string): Promise<void>
  /** `POST /v1/security/mfa/recovery-codes` — codes are returned ONCE. */
  regenerateRecoveryCodes(): Promise<string[]>
  /** `GET /v1/security/mfa/recovery-codes` → `{ remaining, total }` (counts only). */
  getRecoveryCodesStatus(): Promise<RecoveryCodesStatusResult>
}

/** Login step-up (pre-auth; the challengeId is the credential). */
export interface StepUpClient {
  /** `POST /v1/security/mfa/challenge` → 202 ack. */
  challengeMfa(challengeId: string, factorId: string): Promise<MfaChallengeAck>
  /** `POST /v1/security/mfa/verify` → 200 session | 401. */
  verifyMfa(challengeId: string, factorId: string, code: string): Promise<MfaSession>
  /**
   * `POST /v1/security/mfa/verify` with `{ challengeId, recoveryCode }` → 200 session |
   * 401 `RECOVERY_CODE_INVALID` (challenge stays live) | 401 `NOT_ACTIVE` (challenge gone) | 429.
   */
  verifyRecoveryCode(challengeId: string, recoveryCode: string): Promise<MfaSession>
}

/** Contact verification (authenticated). */
export interface ContactClient {
  /** `POST /v1/security/verify/phone/start` → 202. */
  startPhoneVerification(phone: string): Promise<void>
  /** `POST /v1/security/verify/phone/confirm` → 200 status | 401/400. */
  confirmPhoneVerification(phone: string, code: string): Promise<VerificationStatus>
  /** `GET /v1/security/verify/status`. */
  getVerificationStatus(): Promise<VerificationStatus>
}

/** Everything `createAccountSecurityClient` returns. */
export type FullAccountSecurityClient = AccountSecurityClient &
  PasswordClient &
  MfaClient &
  StepUpClient &
  ContactClient
