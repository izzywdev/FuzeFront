/**
 * Provider-neutral errors. Every IdentityProvider implementation throws these
 * for conditions the Security API maps to stable wire codes, so the route layer
 * never depends on a concrete (Authentik) provider module for error mapping.
 */

/**
 * A single-use verification / reset token cannot be redeemed (maps to 400, NOT
 * 401 — a spent link says nothing about the caller's session, and clients treat
 * 401 NOT_ACTIVE as session expiry).
 *   TOKEN_EXPIRED  the token existed but is past its TTL or already consumed
 *   TOKEN_INVALID  the token/code matches nothing redeemable
 */
export class TokenError extends Error {
  constructor(
    public code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID',
    message = code === 'TOKEN_EXPIRED' ? 'token expired or already used' : 'invalid token',
  ) {
    super(message)
    this.name = 'TokenError'
  }
}
