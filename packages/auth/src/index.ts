/**
 * @fuzefront/auth — public barrel (CONTRACT FREEZE).
 *
 * The stable, family-wide authN/authZ client contract. Consumers import the
 * `Identity` shape + `verifyToken`/`requireAuth` here; the underlying token
 * verifier is pluggable (`legacy-hs256` today, `oidc-jwks` target) and the
 * `Identity` shape is invariant across that migration.
 *
 * This package NEVER mints tokens and is FAIL-CLOSED. Runtime verification is a
 * follow-up backend slice — this freeze defines the interface (#117).
 */

export {
  AUTH_CONTRACT_VERSION,
  AuthError,
} from './types';
export type {
  Identity,
  AuthMode,
  AuthErrorCode,
  Verifier,
  VerifierConfig,
  LegacyHs256Config,
  OidcJwksConfig,
  OutOfBandResolver,
} from './types';

export { createVerifier, verifyToken } from './verifyToken';

export {
  requireAuth,
  requireRoles,
  requireTenant,
} from './middleware';
export type { RequireAuthOptions, AuthErrorBody } from './middleware';
