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
}
