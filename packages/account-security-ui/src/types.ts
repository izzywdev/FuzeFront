/**
 * Contract-bound types for the account-security hub.
 *
 * Every request/response shape is derived from the FROZEN Security contract via
 * the generated `@fuzefront/security-client` `components.schemas.*` — never
 * hand-written — so contract drift is a compile error (CLAUDE §contract-first).
 */
import type { components } from '@fuzefront/security-client'

/** The account's sign-in connections: linked social providers + hasPassword. */
export type IdentityConnections = components['schemas']['IdentityConnections']
/** One linked social sign-in connection. */
export type SocialConnection = components['schemas']['SocialConnection']
/** Neutral auth capability descriptor (drives which affordances render). */
export type AuthMethods = components['schemas']['AuthMethods']
/** Supported social provider slug (extensible; `google` first). */
export type SocialProvider = components['schemas']['SocialProvider']
/** Stable, provider-neutral error body. */
export type ErrorBody = components['schemas']['ErrorBody']

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
 * Fields with no backing endpoint yet render an honest "unknown" state (see
 * README / PR notes) rather than fabricated values.
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
}
