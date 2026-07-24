/**
 * googleOidc — the SERVER-BROKERED Google (social) OAuth2/OIDC client.
 *
 * FuzeFront is the OAuth2 client to Google DIRECTLY. The browser is 302'd
 * straight to `accounts.google.com`; on return the security service exchanges the
 * code with Google's token endpoint SERVER-TO-SERVER and validates the id_token.
 * The browser NEVER transits the identity vendor's (Authentik) UI — the whole
 * point of this module. It is the Google analogue of `services/oidc.ts` (which
 * brokers our own IdP), and deliberately reuses `openid-client` so id_token
 * signature validation (Google RS256 via JWKS), PKCE, and the token grant are the
 * library's job, not hand-rolled.
 *
 * Provider-internal: Google is named ONLY here and inside the concrete provider.
 * Nothing above the `IdentityProvider` boundary sees a vendor name.
 */
import { Issuer, Client, generators, custom } from 'openid-client'
import { logger } from '../lib/logger'

/**
 * HTTP timeout for every server-side Google call (discovery, token grant,
 * userinfo, jwks). openid-client defaults to 3500ms, which is BELOW the real p99
 * of the token grant round-trips and is exactly what silently broke Google
 * sign-in before (see services/oidc.ts). Overridable so it can be tuned without a
 * rebuild; shares OIDC_HTTP_TIMEOUT_MS with the IdP client for one knob.
 */
const HTTP_TIMEOUT_MS = Number(process.env.OIDC_HTTP_TIMEOUT_MS) || 15000

/** Google's well-known OIDC issuer — discovery yields auth/token/jwks endpoints. */
const GOOGLE_ISSUER = 'https://accounts.google.com'

/** Validated identity claims we hand back to the broker. */
export interface GoogleIdentity {
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  /** Google's stable subject identifier (used as the source-connection identifier). */
  sub: string
}

export interface GoogleOidcConfig {
  clientId: string
  clientSecret: string
  /** MUST be registered in the Google Cloud console's Authorized redirect URIs. */
  redirectUri: string
}

export function googleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${(process.env.FRONTEND_URL || 'https://app.fuzefront.com').replace(/\/$/, '')}` +
      '/api/v1/security/social/google/callback'
  )
}

export class GoogleOidcService {
  private client: Client | null = null
  private config: GoogleOidcConfig

  constructor(config?: Partial<GoogleOidcConfig>) {
    this.config = {
      clientId: config?.clientId ?? process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: config?.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri: config?.redirectUri ?? googleRedirectUri(),
    }
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret)
  }

  isInitialized(): boolean {
    return this.client !== null
  }

  async initialize(): Promise<void> {
    const start = Date.now()
    if (!this.isConfigured()) {
      // Fail-closed: without client credentials there is no Google broker.
      logger.info('googleOidc: not configured — Google sign-in disabled')
      throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured')
    }
    logger.info('googleOidc: initialize start')
    try {
      custom.setHttpOptionsDefaults({ timeout: HTTP_TIMEOUT_MS })
      const issuer = await Issuer.discover(GOOGLE_ISSUER)
      this.client = new issuer.Client({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uris: [this.config.redirectUri],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        // Google signs id_tokens with RS256; openid-client validates the signature
        // against Google's JWKS automatically on callback.
      })
      logger.info({ elapsedMs: Date.now() - start }, 'googleOidc: initialize succeeded')
    } catch (err) {
      logger.error(
        { elapsedMs: Date.now() - start, err: (err as Error).message },
        'googleOidc: initialize failed'
      )
      throw err
    }
  }

  /** Build the absolute `accounts.google.com` authorize URL + this flow's PKCE verifier. */
  generateAuthUrl(state: string): { url: string; codeVerifier: string } {
    if (!this.client) throw new Error('Google OIDC client not initialized')
    const codeVerifier = generators.codeVerifier()
    const codeChallenge = generators.codeChallenge(codeVerifier)
    const url = this.client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      // Ask Google to always return a fresh consent selection screen so a shared
      // browser cannot silently reuse another account's Google session.
      prompt: 'select_account',
    })
    return { url, codeVerifier }
  }

  /**
   * Exchange the code SERVER-TO-SERVER and return the VALIDATED identity claims.
   * Never logs tokens. Throws on any protocol/validation failure (fail-closed).
   */
  async handleCallback(code: string, state: string, codeVerifier: string, iss?: string): Promise<GoogleIdentity> {
    const start = Date.now()
    logger.info('googleOidc: callback start')
    try {
      if (!this.client) throw new Error('Google OIDC client not initialized')
      if (!codeVerifier) throw new Error('code_verifier missing for Google callback')
      const tokenSet = await this.client.callback(
        this.config.redirectUri,
        // Google sends `iss` in the redirect (RFC 9207) and openid-client
        // REQUIRES it when discovery advertises the parameter — dropping it
        // fails the callback with "iss missing from the response".
        { code, state, ...(iss ? { iss } : {}) },
        { code_verifier: codeVerifier, state }
      )
      const claims = tokenSet.claims()
      const email = claims.email
      if (!email || typeof email !== 'string') {
        throw new Error('Google id_token did not include an email claim')
      }
      logger.info(
        { elapsedMs: Date.now() - start },
        'googleOidc: callback succeeded'
      )
      return {
        email,
        emailVerified: claims.email_verified === true || (claims as any).email_verified === 'true',
        firstName: (claims.given_name as string | undefined) ?? undefined,
        lastName: (claims.family_name as string | undefined) ?? undefined,
        sub: claims.sub,
      }
    } catch (err) {
      // Never log `code`/tokens — only the error message, which never carries them.
      logger.error(
        { elapsedMs: Date.now() - start, err: (err as Error).message },
        'googleOidc: callback failed'
      )
      throw err
    }
  }
}

export const googleOidcService = new GoogleOidcService()
