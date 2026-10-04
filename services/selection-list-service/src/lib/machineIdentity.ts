// lib/machineIdentity.ts — this service's OWN identity toward the Security API.
//
// WHY. Access grants (`grantListOwner` on create, grant/revoke in routes/access.ts)
// used to be written with the END USER's bearer token. That only worked because
// the Security API let any human session mutate the authorization graph
// (docs/security/selection-lists-authz-review-2026-10.md, C-1). The Security API
// is being fixed so a non-admin human is denied grants; and even before then,
// "the user authorizes their own grant" was the escalation path, not a design.
//
// The sanctioned shape (backend/security/src/routes/authz.ts): a MACHINE caller
// (OAuth client_credentials) whose introspected scope includes
// `authz:admin` (AUTHZ_ADMIN_SCOPE). This module mints/caches/refreshes that
// token with `@fuzefront/service-auth` (createServiceAuthClient: cached,
// refreshed before expiry, single-flight) and nothing else — no hand-rolled
// token plumbing.
//
// What stays on the end user's token: decisions (`check` / `bulkCheck`) — they
// answer "may THIS user act", and the Security API evaluates them for the
// presented principal.
//
// Fail CLOSED: with no client id/secret configured (outside the unit-test no-op
// mode) `getGrantToken()` throws `MachineIdentityError`. The grant/revoke call
// that needed it fails, the create transaction rolls back, and the route
// answers 500 — never a silent fallback to the caller's own token.
//
// Env (secret values come from the `selection-list-secrets` Secret, never from
// this repo):
//   SELECTION_LIST_SERVICE_CLIENT_ID      OAuth client id of this service
//   SELECTION_LIST_SERVICE_CLIENT_SECRET  its secret
//   SELECTION_LIST_SERVICE_TOKEN_SCOPE    optional; default `authz:admin`
//   SECURITY_SERVICE_URL                  Security API ORIGIN (no /api suffix)

import { createServiceAuthClient } from '@fuzefront/service-auth';
import type { ServiceAuthClient } from '@fuzefront/service-auth';
import { createLoggedFetch, getLog, logger } from './logger';

/** Scope the Security API requires of a machine caller that mutates grants. */
export const AUTHZ_ADMIN_SCOPE = 'authz:admin';

/** Anything that can hand out a bearer token for a grant/revoke call. */
export interface GrantTokenProvider {
  getToken(): Promise<string>;
}

export class MachineIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MachineIdentityError';
  }
}

let injected: GrantTokenProvider | null = null;
let cached: ServiceAuthClient | null = null;

/** Test/DI seam: pin the provider. Pass null to restore env-driven resolution. */
export function _setGrantTokenProviderForTesting(p: GrantTokenProvider | null): void {
  injected = p;
  cached = null;
}

export function machineIdentityConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SELECTION_LIST_SERVICE_CLIENT_ID && env.SELECTION_LIST_SERVICE_CLIENT_SECRET);
}

function resolveClient(): ServiceAuthClient {
  if (cached) return cached;
  const clientId = process.env.SELECTION_LIST_SERVICE_CLIENT_ID;
  const clientSecret = process.env.SELECTION_LIST_SERVICE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new MachineIdentityError(
      'machine identity is not configured (SELECTION_LIST_SERVICE_CLIENT_ID / SELECTION_LIST_SERVICE_CLIENT_SECRET): ' +
        'refusing to write access grants without it',
    );
  }
  cached = createServiceAuthClient({
    baseUrl: process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002',
    clientId,
    clientSecret,
    scope: process.env.SELECTION_LIST_SERVICE_TOKEN_SCOPE || AUTHZ_ADMIN_SCOPE,
    // Boundary logging (start/end/elapsedMs, x-request-id) on the token call too.
    fetch: createLoggedFetch() as never,
  });
  return cached;
}

/**
 * A bearer token carrying this service's machine identity, for Security API
 * grant/revoke. Throws (fail closed) when unconfigured or when issuance fails.
 */
export async function getGrantToken(): Promise<string> {
  if (injected) return injected.getToken();
  // Unit-test no-op mode — the exact condition middleware/authz.ts uses to swap
  // in its allow-all AuthzClient (NODE_ENV=test and no explicit
  // SECURITY_SERVICE_URL): that client never looks at the token, and no network
  // call is made. Any run that points at a real/stand-in Security API
  // (integration CI sets SECURITY_SERVICE_URL) takes the real path below.
  if (process.env.NODE_ENV === 'test' && !process.env.SECURITY_SERVICE_URL) {
    return 'noop-machine-token';
  }
  try {
    return await resolveClient().getToken();
  } catch (err) {
    // Log the class + code only: never the secret, never a token.
    getLog().error(
      { err: { name: (err as Error)?.name, code: (err as { code?: string })?.code, message: (err as Error)?.message } },
      'machine token unavailable — grant/revoke will fail closed',
    );
    throw err;
  }
}

/** Startup self-check: make a missing machine identity LOUD, not a surprise at first create. */
export function logMachineIdentityStatus(): void {
  if (machineIdentityConfigured()) {
    logger.info({ scope: process.env.SELECTION_LIST_SERVICE_TOKEN_SCOPE || AUTHZ_ADMIN_SCOPE }, 'machine identity configured for Security API grants');
  } else {
    logger.error(
      'machine identity NOT configured (SELECTION_LIST_SERVICE_CLIENT_ID/_SECRET) — list creation and access grants will fail closed until it is',
    );
  }
}
