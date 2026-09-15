import type { RequestHandler } from 'express';
import {
  createMachineTokenVerifier,
  requireMachineAuth,
  type MachineTokenVerifier,
} from '@fuzefront/service-auth';

/**
 * Guards the neutral Payment Provider API: consumers (billing-service / the host
 * proxy) present a FuzeFront-issued **managed service token** as a Bearer token,
 * which this middleware verifies against security-service's
 * `/api/v1/security/tokens/introspect` contract via `@fuzefront/service-auth`'s
 * `MachineTokenVerifier` (fail-closed — it branches on the introspection body's
 * `active`, never on HTTP status).
 *
 * This REPLACES the previous hand-minted static shared bearer
 * (`PAYMENT_INTERNAL_TOKEN`), which was open when the token was unset. There is
 * no "open when unset" fallback here: a missing/invalid token is always 401, and
 * a missing `securityServiceUrl` is a hard misconfiguration that fails loud at
 * startup rather than silently leaving the surface open.
 */
export interface InternalAuthOptions {
  /**
   * Origin of FuzeFront's Security API (e.g. `http://fuzefront-security:3002`)
   * that machine tokens are verified against. Origin only — the verifier appends
   * the `/api/v1/security/tokens/introspect` path itself. Required unless a
   * `verifier` is injected.
   */
  securityServiceUrl?: string;
  /**
   * Pre-built verifier. Test seam — lets unit tests inject a stub instead of
   * reaching a live security-service. When set, `securityServiceUrl` is ignored.
   */
  verifier?: MachineTokenVerifier;
}

/**
 * Build the Express middleware that gates the internal API behind a verified
 * managed service token. Fails CLOSED:
 *  - no/garbage/invalid token  -> 401 `{ error, code }` (from `requireMachineAuth`)
 *  - `securityServiceUrl` unset (and no injected verifier) -> `createMachineTokenVerifier`
 *    throws `MISCONFIGURED` here, at app assembly, so the pod crashes loudly
 *    instead of coming up with an unauthenticated internal API.
 */
export function createInternalAuth(options: InternalAuthOptions): RequestHandler {
  const verifier =
    options.verifier ??
    createMachineTokenVerifier({ baseUrl: options.securityServiceUrl ?? '' });
  // `@fuzefront/service-auth` types its handler against express 4 (its optional
  // peer's @types default); payment-service is on express 5. The two `Request`
  // type copies are structurally incompatible (`param` etc.), so bridge them at
  // this single boundary — it is a plain express middleware function at runtime.
  return requireMachineAuth({ verifier }) as unknown as RequestHandler;
}
