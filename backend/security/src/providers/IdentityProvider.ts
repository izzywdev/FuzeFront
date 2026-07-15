/**
 * IdentityProvider — the internal swap contract for AuthN.
 *
 * This interface is the KEYSTONE that makes the identity backend swappable.
 * The FuzeFront Security API (`/api/v1/security/*`) is implemented purely in
 * terms of this interface; no route, consumer, or the frontend ever references
 * a concrete provider. The first concrete implementation is
 * `AuthentikIdentityProvider` (absorbing today's `services/oidc.ts`,
 * `services/authentikPassword.ts`, and the M2M provisioning code) — but it is
 * one implementation of many possible.
 *
 * INTERFACE ONLY — no behavior lives here. Implementations are OUT OF SCOPE for
 * the contract freeze (they belong to `backend-engineer`, Phase 1).
 *
 * Naming rule: no vendor names in this contract's shapes. Provider names live
 * only inside the concrete impl files and server-only env.
 *
 * Fail-closed: every method rejects (throws) on any provider/transport error;
 * a caller never receives a permissive fallback identity or session.
 */

/** A minted FuzeFront session, returned by password login / signup / exchange. */
export interface BrokeredSession {
  /** FuzeFront-minted session token. */
  token: string;
  /** Server session identifier. */
  sessionId: string;
  /** Hydrated user for the session. */
  user: BrokeredUser;
}

/** Hydrated user shape (mirrors the API `User` schema). */
export interface BrokeredUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  defaultAppId?: string;
  roles: string[];
}

/** Normalized identity for an already-presented token (mirrors API `Identity`). */
export interface NormalizedIdentity {
  userId: string;
  tenantId: string | null;
  roles: string[];
  email?: string;
  authMode: 'legacy-hs256' | 'federated-jwks';
  issuedAt?: number;
  expiresAt?: number;
  issuer?: string;
}

export interface PasswordLoginInput {
  email: string;
  password: string;
}

export interface SignupInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** Optional tenant/organization name to provision on signup. */
  tenantName?: string;
}

/**
 * The outcome of beginning a social login. The service 302s the browser to
 * `redirectUrl` (a FuzeFront-owned same-host authorize path that transits only
 * to the social provider's own consent host). `state` is persisted server-side
 * for the anti-forgery check at callback.
 */
export interface SocialLoginStart {
  /** Location to 302 the browser to. Never an internal identity host. */
  redirectUrl: string;
  /** Opaque anti-forgery state the callback must echo. */
  state: string;
  /**
   * PKCE code_verifier for this authorize request. The route persists it in an
   * HttpOnly cookie so the (replica-agnostic) OIDC callback can complete the
   * token exchange — the social handshake transits the registered OIDC
   * redirect_uri (`/api/auth/oidc/callback`), which reads this cookie.
   */
  codeVerifier: string;
}

export interface SocialCallbackInput {
  /** Protocol-level provider authorization code (consumed server-side). */
  code: string;
  /** Anti-forgery state issued at start. */
  state: string;
}

/**
 * The outcome of the broker callback: a single-use opaque code the SPA
 * exchanges via `POST /session/exchange`, plus the app-relative path to return
 * the browser to. No token is ever placed in the redirect URL.
 */
export interface SocialCallbackResult {
  /** FuzeFront-minted single-use opaque code. */
  code: string;
  /** Same-origin app path to redirect the browser back to. */
  redirectTo: string;
}

export interface M2MClientProvisionInput {
  /** Human-readable name for the machine client. */
  name: string;
  /** Optional requested scope string. */
  scope?: string;
}

export interface M2MClient {
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface M2MTokenInput {
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface M2MToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope?: string;
}

/** Fail-closed introspection result for an M2M/session token. */
export interface TokenIntrospection {
  active: boolean;
  subject?: string;
  tenantId?: string | null;
  scope?: string;
  expiresAt?: number;
}

// ── MFA (provider-agnostic; TOTP / SMS-OTP / email-OTP, WebAuthn reserved) ──

/** Neutral factor type. `webauthn` reserved for later. */
export type MfaFactorType = 'totp' | 'sms' | 'email' | 'webauthn';

export interface MfaFactor {
  factorId: string;
  type: MfaFactorType;
  status: 'pending' | 'active';
  /** Neutral display hint (e.g. masked phone/email); never a provider name. */
  label?: string;
  createdAt?: number;
}

export interface MfaEnrollInput {
  type: MfaFactorType;
  /** Required when `type` is `sms`. */
  phone?: string;
  /** Required when `type` is `email`. */
  email?: string;
}

/**
 * Enrollment material. For `totp`, `secret` + `provisioningUri` are present
 * (render a QR); for `sms`/`email`, `codeSent` indicates an OTP was dispatched.
 */
export interface MfaEnrollResult {
  factorId: string;
  type: MfaFactorType;
  status: 'pending' | 'active';
  secret?: string;
  provisioningUri?: string;
  codeSent?: boolean;
}

/** Minimal factor reference offered inside a login MFA challenge. */
export interface MfaFactorRef {
  factorId: string;
  type: MfaFactorType;
}

export interface MfaChallengeAck {
  challengeId: string;
  factorId: string;
  /** True when an OTP was dispatched; false/undefined for TOTP prompts. */
  delivered?: boolean;
}

/** Contact-ownership verification status for a user. */
export interface VerificationStatus {
  emailVerified: boolean;
  phoneVerified: boolean;
  phone?: string;
}

/**
 * The AuthN swap contract. Shaped from the current server-brokered behavior in
 * `backend/security/src/routes/auth.ts` (`/oidc/password` :520, `/oidc/login`
 * :368, `/oidc/signup` :437, callback :631, token-exchange :802) and
 * `services/*`. Providers are swappable behind it.
 */
export interface IdentityProvider {
  /** Password login (server-brokered). Rejects on bad credentials. */
  passwordLogin(input: PasswordLoginInput): Promise<BrokeredSession>;

  /** Begin a social login; returns where to 302 the browser + anti-forgery state. */
  startSocialLogin(provider: string, redirectTo?: string): Promise<SocialLoginStart>;

  /** Complete the social handshake; returns a single-use opaque code + return path. */
  brokerCallback(input: SocialCallbackInput): Promise<SocialCallbackResult>;

  /** Exchange a single-use opaque code for a session. Rejects on unknown/expired code. */
  exchangeCode(code: string): Promise<BrokeredSession>;

  /** Server-brokered account creation. Rejects with CONFLICT if the email exists. */
  signup(input: SignupInput): Promise<BrokeredSession>;

  /** Normalized identity + user for a presented session token ("me"). */
  getUserInfo(token: string): Promise<{ identity: NormalizedIdentity; user: BrokeredUser }>;

  /** Revoke the presented session. Idempotent. */
  logout(token: string): Promise<void>;

  /** Provision an M2M service client. */
  provisionM2MClient(input: M2MClientProvisionInput): Promise<M2MClient>;

  /** Issue an M2M access token (client-credentials style). */
  issueM2MToken(input: M2MTokenInput): Promise<M2MToken>;

  /** Introspect a presented token. Fail-closed: unknown/expired ⇒ { active: false }. */
  introspectToken(token: string): Promise<TokenIntrospection>;

  // ── MFA factor management + login step-up ──
  //
  // Provider-agnostic. The identity provider's MFA stages and the family
  // email-service / sms-service (SMS OTP via the family verification service)
  // are the FIRST implementations behind this contract — swappable, and named
  // only inside the concrete impl.

  /** List the user's enrolled factors (bounded per user). */
  listFactors(token: string): Promise<MfaFactor[]>;

  /** Begin enrolling a factor; returns enrollment material (pending activation). */
  enrollFactor(token: string, input: MfaEnrollInput): Promise<MfaEnrollResult>;

  /** Activate a pending factor with a one-time code. Rejects on bad/expired code. */
  activateFactor(token: string, factorId: string, code: string): Promise<MfaFactor>;

  /** Remove an enrolled factor. Idempotent. */
  removeFactor(token: string, factorId: string): Promise<void>;

  /** (Re)generate one-time recovery codes; returns them once. */
  regenerateRecoveryCodes(token: string): Promise<string[]>;

  /** Trigger a login-step-up challenge (deliver OTP or signal TOTP prompt). */
  challengeMfa(challengeId: string, factorId: string): Promise<MfaChallengeAck>;

  /** Verify a login-step-up challenge; on success returns an authenticated session. */
  verifyMfa(challengeId: string, factorId: string, code: string): Promise<BrokeredSession>;

  // ── Contact-ownership verification (distinct from MFA login step-up) ──

  /** Send an email verification link/code (current user, or a signup-scoped address). */
  startEmailVerification(token: string | null, email?: string): Promise<void>;

  /** Confirm email ownership via a link `token` or an OTP `code`. */
  confirmEmailVerification(input: { token?: string; code?: string }): Promise<VerificationStatus>;

  /** Send an SMS OTP to a phone number. */
  startPhoneVerification(token: string, phone: string): Promise<void>;

  /** Confirm phone ownership via `{ phone, code }`. */
  confirmPhoneVerification(phone: string, code: string): Promise<VerificationStatus>;

  /** Current contact-verification status for the user. */
  getVerificationStatus(token: string): Promise<VerificationStatus>;
}
