/**
 * Shared single-use opaque broker-code store.
 *
 * The browser OIDC completion (`/api/auth/oidc/callback`) mints a short-lived
 * opaque `?code=` instead of putting a bearer token in the URL. The SPA then
 * exchanges it. Historically two SEPARATE in-memory maps existed:
 *   - routes/auth.ts               (redeemed by POST /api/auth/token-exchange)
 *   - AuthentikIdentityProvider    (redeemed by POST /api/v1/security/session/exchange)
 *
 * The provider-agnostic Security API SPA exchanges via
 * `/api/v1/security/session/exchange`, but social login now transits the LEGACY
 * `/api/auth/oidc/callback` (the OIDC client's registered redirect_uri). With
 * two maps the code minted by the callback was unredeemable by the new
 * endpoint. This module is the SINGLE store both paths use, so a code minted by
 * either callback is redeemable by either exchange endpoint.
 *
 * In-memory + single-use + short TTL; a code is redeemed at most once.
 */
import type { BrokeredUser } from '../providers/IdentityProvider'
import { logger } from '../lib/logger'

export interface BrokerCodeEntry {
  token: string
  sessionId: string
  /** Full user projection carried through so redemption needs no DB read. */
  user: BrokeredUser
  expiresAt: number
}

const store = new Map<string, BrokerCodeEntry>()

export function putBrokerCode(code: string, entry: BrokerCodeEntry): void {
  store.set(code, entry)
  // Never log the code/token themselves (pino redaction also strips these
  // keys if it ever changes shape) — only correlation metadata.
  logger.debug(
    { sessionId: entry.sessionId, expiresAt: entry.expiresAt },
    'brokerCodes: code issued'
  )
}

/** Redeem a code exactly once; returns null when unknown/expired. */
export function takeBrokerCode(code: string, now = Date.now()): BrokerCodeEntry | null {
  const entry = store.get(code)
  if (!entry) {
    logger.debug('brokerCodes: redeem miss — unknown code')
    return null
  }
  store.delete(code) // single-use
  if (entry.expiresAt < now) {
    logger.info({ sessionId: entry.sessionId }, 'brokerCodes: redeem miss — expired code')
    return null
  }
  logger.debug({ sessionId: entry.sessionId }, 'brokerCodes: redeemed')
  return entry
}

/** Sweep never-redeemed expired codes. */
export function sweepBrokerCodes(now = Date.now()): void {
  let swept = 0
  for (const [code, entry] of store) {
    if (entry.expiresAt < now) {
      store.delete(code)
      swept++
    }
  }
  if (swept > 0) {
    logger.debug({ swept }, 'brokerCodes: swept expired codes')
  }
}
