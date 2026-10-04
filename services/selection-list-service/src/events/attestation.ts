// events/attestation.ts - verification of the `seed.requested` attestation token (plan section 8).
//
// The topic is unauthenticated, so authentication rides IN the message: a short-lived OAuth
// `client_credentials` token with scope `selection-lists:seed`. We introspect it with the
// family's fail-closed verifier (`@fuzefront/service-auth`, POST
// /api/v1/security/tokens/introspect: it branches on the body's `active`, never on HTTP
// status) and require the scope. The introspected `subject` is the authenticated caller; the
// seed library matches it against the allowlisted source row.
//
// Two kinds of "no":
//   - the token is not acceptable (inactive/expired/revoked, missing scope, no subject):
//     a REFUSAL -> `{ ok: false }` -> `seed.failed` / ATTESTATION_INVALID (retryable: re-send with
//     a fresh token). Nothing is written.
//   - we could not DECIDE (introspection unreachable / malformed answer / not configured): that
//     is our infrastructure, not the requester's fault -> `AttestationUnavailableError`, which the
//     handler lets propagate so the consumer retries. Still fail closed: nothing is written.
//
// The token is a bearer secret. It is passed to the verifier and nowhere else: never logged
// (the logger also redacts `*.token`), never put in an event, a failure message or detail.

import { createMachineTokenVerifier, ServiceAuthError } from '@fuzefront/service-auth';
import type { MachineIdentity, MachineTokenVerifier } from '@fuzefront/service-auth';
import { createLoggedFetch } from '../lib/logger';
import { SEED_ATTESTATION_SCOPE } from '../seed/sources';

export type AttestationVerdict = { ok: true; subject: string } | { ok: false; message: string };

/** Introspection could not be consulted; the message must be retried, not refused. */
export class AttestationUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AttestationUnavailableError';
  }
}

/** Codes that mean "the token is bad" (refusal), as opposed to "we could not ask" (retry). */
const REFUSAL_CODES = new Set(['TOKEN_INACTIVE', 'NO_TOKEN', 'MALFORMED_HEADER', 'FORBIDDEN']);

let injected: MachineTokenVerifier | null = null;
let cached: MachineTokenVerifier | null = null;

/** Test/DI seam: pin the verifier. Pass null to restore env-driven resolution. */
export function _setAttestationVerifierForTesting(v: MachineTokenVerifier | null): void {
  injected = v;
  cached = null;
}

function resolveVerifier(): MachineTokenVerifier {
  if (injected) return injected;
  if (!cached) {
    cached = createMachineTokenVerifier({
      baseUrl: process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002',
      fetch: createLoggedFetch() as never,
    });
  }
  return cached;
}

/**
 * Verify a seed attestation token. Never throws for a bad token (returns `{ ok: false }`);
 * throws `AttestationUnavailableError` only when introspection cannot decide.
 */
export async function verifySeedAttestation(token: string, nowMs: number = Date.now()): Promise<AttestationVerdict> {
  let identity: MachineIdentity;
  try {
    identity = await resolveVerifier().verifyMachineToken(token);
  } catch (err) {
    const code = err instanceof ServiceAuthError ? err.code : 'UNKNOWN';
    if (REFUSAL_CODES.has(code)) {
      return { ok: false, message: 'The attestation token is not active (expired, revoked or unknown); re-send with a fresh service token.' };
    }
    // Class + code only: never the error text of a request that carried the token.
    throw new AttestationUnavailableError(`attestation could not be verified (${code})`, code);
  }
  if (typeof identity.expiresAt === 'number' && identity.expiresAt * 1000 <= nowMs) {
    return { ok: false, message: 'The attestation token has expired; re-send with a fresh service token.' };
  }
  if (!identity.scopes.includes(SEED_ATTESTATION_SCOPE)) {
    return { ok: false, message: `The attestation token does not carry the "${SEED_ATTESTATION_SCOPE}" scope.` };
  }
  if (!identity.subject) {
    return { ok: false, message: 'The attestation token has no subject.' };
  }
  return { ok: true, subject: identity.subject };
}
