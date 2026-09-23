// authz.ts — billing-service's Security API client bootstrap. Step 3 of 3 in
// an owner-requested migration off the embedded Permit.io SDK, onto
// backend/security's provider-agnostic `AuthorizationProvider` seam
// (`authzFactory.ts`) via the shared `@fuzefront/auth` client
// (`createAuthzClient`). config-service was step 1 (#679), selection-list-
// service was step 2 (#699); this is the last of the three. Permit is now
// purely an implementation detail of that seam — billing-service knows
// nothing about it. It talks to exactly one thing: FuzeFront's own Security
// API. No vendor SDK, no vendor API key here.
//
// Unlike config-service / selection-list-service, billing-service never
// gates an inbound HTTP request against the Security API — it only performs
// the single WRITE `setAttributes` call from `PermitSyncService`
// (`services/permit.service.ts`), authenticated with a machine token (see
// `machineToken.ts`).

import { AuthzClient, createAuthzClient } from '@fuzefront/auth';

/**
 * In-cluster Service DNS for backend/security
 * (`deploy/helm/fuzefront/templates/security.yaml`), matching the
 * `SECURITY_SERVICE_URL` convention config-service and selection-list-service
 * already use for the same Service.
 */
const SECURITY_SERVICE_URL = process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002';

/** `NODE_ENV=test` with no explicit client wired -> allow-all, no network. */
export const isNoOpMode: boolean = process.env.NODE_ENV === 'test';

/**
 * A fully-typed no-op `AuthzClient` used only when `NODE_ENV=test` and no
 * explicit mock has been wired via `_setAuthzClientForTesting()`. billing-
 * service only ever calls `setAttributes` — `check`/`bulkCheck`/`grant`/
 * `revoke`/`listGrants` are stubbed only so this double keeps satisfying the
 * interface; a real call to any of them would be a bug in this service.
 */
function makeNoOpProxy(): AuthzClient {
  return {
    check: async () => ({ allow: true }),
    bulkCheck: async (checks) => checks.map(() => ({ allow: true })),
    grant: async (): Promise<never> => {
      throw new Error('makeNoOpProxy: grant() is not used by billing-service');
    },
    revoke: async (): Promise<never> => {
      throw new Error('makeNoOpProxy: revoke() is not used by billing-service');
    },
    listGrants: async (): Promise<never> => {
      throw new Error('makeNoOpProxy: listGrants() is not used by billing-service');
    },
    setAttributes: async (req) => ({
      subject: req.subject,
      attributes: req.attributes,
      updatedAt: Date.now(),
    }),
  };
}

let _authzClient: AuthzClient = isNoOpMode
  ? makeNoOpProxy()
  : createAuthzClient({ baseUrl: SECURITY_SERVICE_URL });

/** Returns the active authz client (real or no-op). */
export function getAuthzClient(): AuthzClient {
  return _authzClient;
}

/**
 * Test seam: swap the authz client for a mock.
 * Call with `makeNoOpProxy()` or a jest mock object.
 * Tests should restore the original client in afterEach.
 */
export function _setAuthzClientForTesting(client: AuthzClient): void {
  _authzClient = client;
}

export { makeNoOpProxy };
