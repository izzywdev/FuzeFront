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

/**
 * A login step-up challenge is unknown, expired, already completed, or has a
 * proof in flight. Maps to 401 NOT_ACTIVE and counts against the caller's IP
 * limiter only (never a per-challenge key: the id is attacker-chosen).
 */
export class ChallengeNotActiveError extends Error {
  constructor(message = 'invalid or expired challenge') {
    super(message)
    this.name = 'ChallengeNotActiveError'
  }
}

/**
 * A submitted recovery code was wrong, already used, from a replaced set, or
 * from a legacy (pre-v2) set. The causes are deliberately indistinguishable
 * (contract 1.3.0). Maps to 401 RECOVERY_CODE_INVALID.
 */
export class RecoveryCodeInvalidError extends Error {
  constructor() {
    super('invalid recovery code')
    this.name = 'RecoveryCodeInvalidError'
  }
}
