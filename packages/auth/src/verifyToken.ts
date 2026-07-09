/**
 * @fuzefront/auth — top-level verification API (CONTRACT FREEZE).
 *
 * These are the frozen SIGNATURES the whole family codes against. Runtime
 * behavior (JWKS fetch, jsonwebtoken/jose verification) is a FOLLOW-UP backend
 * slice — the bodies here throw `NOT_IMPLEMENTED` on purpose so nobody mistakes
 * the freeze for a working implementation, while types still compile and the
 * generated `.d.ts` is the stable public interface.
 */

import { AuthError, Identity, Verifier, VerifierConfig } from './types';

/** Marker error so the freeze is unmistakable at runtime. */
function notImplemented(): never {
  throw new AuthError(
    'VERIFIER_UNAVAILABLE',
    '@fuzefront/auth is contract-frozen; runtime verification is a follow-up backend slice. See #117.',
    500,
  );
}

/**
 * Build a `Verifier` for the given mode. The returned verifier is FAIL-CLOSED.
 *
 * @example
 *   const v = createVerifier({ mode: 'legacy-hs256', secret: process.env.JWT_SECRET!, resolver });
 *   const identity = await v.verify(rawToken);
 */
export function createVerifier(config: VerifierConfig): Verifier {
  void config;
  // Interface freeze only — see module note.
  return {
    // The real factory returns a concrete Legacy/Oidc verifier keyed on config.mode.
    get mode() {
      return config.mode;
    },
    verify(_token: string): Promise<Identity> {
      void _token;
      return Promise.reject(
        new AuthError(
          'VERIFIER_UNAVAILABLE',
          '@fuzefront/auth is contract-frozen; verifier runtime not yet implemented (#117).',
          500,
        ),
      );
    },
  };
}

/**
 * Verify a raw bearer token (already stripped of the `Bearer ` prefix) and
 * return the normalized `Identity`. Throws `AuthError` on any failure
 * (fail-closed). This is a convenience over `createVerifier().verify()` when a
 * single verifier is used process-wide.
 *
 * FROZEN SIGNATURE — implementation is a follow-up slice.
 */
export function verifyToken(_token: string, _verifier: Verifier): Promise<Identity> {
  void _token;
  void _verifier;
  return _verifier.verify(_token).catch((e) => {
    throw e;
  });
}

/** Never used at runtime in the freeze; referenced to keep `notImplemented` live for the real impl. */
export const __FROZEN__ = notImplemented;
