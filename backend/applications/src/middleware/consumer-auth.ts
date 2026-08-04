// Unified app-registry authentication: pre-shared consumer token OR JWT session.
//
// The app-registry is called by TWO different kinds of caller and both must work
// on every route:
//
//   1. CONSUMER PRODUCTS (FuzeHub, FuzeSales, …) running `register.sh` as a
//      Kubernetes init container. They have no human, no OIDC session, and no way
//      to obtain a JWT — they present the pre-shared CONSUMER_REGISTRATION_SECRET
//      as a Bearer token. A match is treated as a platform-admin service call
//      (isPlatformAdmin: true via resolveCaller), so Permit checks are bypassed.
//
//   2. HUMANS / ADMIN UI, carrying an Authentik-issued JWT, validated by
//      authenticateToken from @fuzeone/core.
//
// Order matters: the constant-time consumer-secret comparison runs FIRST and only
// falls through to JWT validation on a miss, so a JWT caller is never charged the
// secret comparison's failure path and a consumer never hits JWKS.
//
// WHY THIS IS ON EVERY ROUTE, NOT JUST POST /apps. register.sh's FIRST call is
// `GET /apps/:slug` (the idempotency probe: 200 = already registered, 404 =
// register now) and it re-PUTs the manifest on every redeploy so manifest edits
// are not frozen at first registration. It also PUTs policy.json and
// billing-profile.json. With the consumer token accepted on only POST /apps and
// POST /apps/:slug/activate, the probe 401s and the script's `401|403) die` arm
// CrashLoopBackOffs the consumer's pod before it ever reaches the register call.
//
// FAIL-SAFE: when CONSUMER_REGISTRATION_SECRET is unset (the current prod state —
// the key is absent from the sealed fuzefront-secrets and the env var is mounted
// `optional: true`), this degrades to plain JWT auth. That is why every token an
// operator tried against prod returned 401: there was no secret to match, so the
// consumer branch was never reachable.
import type { Request, Response, NextFunction } from 'express'
import { authenticateToken } from './auth'

// Shaped to satisfy @fuzeone/core's User. `email` is required there; this
// caller is a service, not a person, so it carries a non-routable sentinel
// address rather than anything that could collide with a real account.
const SYNTHETIC_CONSUMER_USER = {
  id: 'consumer-registration',
  email: 'consumer-registration@fuzefront.invalid',
  roles: ['admin'] as string[],
}

/**
 * Length-independent constant-time-ish comparison. Returning early on a length
 * mismatch leaks only the length, which is not secret; the byte loop below does
 * not short-circuit, so a correct prefix is not distinguishable by timing.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function authenticateConsumerOrSession(
  req: Request & { user?: unknown },
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.CONSUMER_REGISTRATION_SECRET
  if (secret) {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ') && safeEqual(auth.slice(7), secret)) {
      req.user = SYNTHETIC_CONSUMER_USER
      next()
      return
    }
  }
  // Not the consumer secret (or none configured) → ordinary JWT session auth.
  // authenticateToken returns a Response when it rejects; this middleware's
  // contract is void, so the result is deliberately discarded.
  void authenticateToken(req as any, res, next)
}
