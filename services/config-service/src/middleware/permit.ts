/**
 * Permit.io authorization middleware for config-service (FFRNT-157).
 *
 * Mirrors `services/selection-list-service/src/middleware/permit.ts`'s design:
 *
 *  1. Fail CLOSED: any error from Permit.io -> 403. Never fail open.
 *  2. CI / unit-test no-op mode: when PERMIT_API_KEY is a known CI dummy key
 *     OR (NODE_ENV=test AND the key does not look like a real permit key), a
 *     recursive no-op proxy stands in and allows every `.check()` call. Tests
 *     that need to exercise a real denial inject a mock via
 *     `_setPermitClientForTesting()`.
 *
 * Unlike selection-list-service's `requirePermit`, this is NOT behind a
 * release flag: FFRNT-157 AC4 requires a caller with no Permit authority over
 * the requested scope to get a real 403 ("An id is never a capability" —
 * CLAUDE.md), so authorization here is always active, not dark-launched. (The
 * SEPARATE `fuzefront.platform.config-management` flag, FF-EPIC-17-S8 /
 * FFRNT-255, gates whether platform CONSUMERS read config-service at all —
 * that is a different flag, owned by a different story, not this one.)
 */

import { Request, Response, NextFunction } from 'express';
import { Permit } from 'permitio';

const PERMIT_API_KEY = process.env.PERMIT_API_KEY ?? '';
const PERMIT_PDP_URL = process.env.PERMIT_PDP_URL ?? 'https://cloudpdp.api.permit.io';

/** Keys that signal "no real Permit account available" — CI / offline mode. */
const CI_DUMMY_KEYS = new Set(['ci-no-real-permit-calls', 'ci-noop', 'ci-offline-pdp-key']);

export const isNoOpMode: boolean =
  CI_DUMMY_KEYS.has(PERMIT_API_KEY) || (process.env.NODE_ENV === 'test' && !PERMIT_API_KEY.startsWith('permit_key_'));

function makeNoOpProxy(): any {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'check') {
        return () => Promise.resolve(true);
      }
      return new Proxy(
        function noOp() {
          return Promise.resolve(undefined);
        },
        handler,
      );
    },
    apply(_target, _thisArg, _args) {
      return Promise.resolve(undefined);
    },
  };
  return new Proxy({}, handler);
}

let _permitClient: any = isNoOpMode ? makeNoOpProxy() : new Permit({ token: PERMIT_API_KEY, pdp: PERMIT_PDP_URL });

export function getPermitClient(): any {
  return _permitClient;
}

/** Test seam: swap the Permit client for a mock. Restore in afterEach. */
export function _setPermitClientForTesting(client: any): void {
  _permitClient = client;
}

export { makeNoOpProxy };

/** The Permit resource this service checks every read against. */
export const CONFIG_SCOPE_RESOURCE = 'ConfigScope';
export const CONFIG_CATALOG_RESOURCE = 'ConfigCatalog';

/**
 * Returns an Express middleware that enforces a Permit.io `check()`.
 *
 * @param resource        Permit resource type (e.g. 'ConfigScope').
 * @param action           Permit action (e.g. 'read').
 * @param resourceKeyOf    Derives the resource-instance key + tenant from the
 *                          request (e.g. the namespace, or `scopeType:scopeId`).
 *                          Omitted -> a tenant-level check with no instance key.
 *
 * Requires `requireAuth` upstream (reads `req.userId`/`req.orgId`). Missing
 * identity -> 401 (should be unreachable in practice since requireAuth runs
 * first, but this middleware must not silently pass a request with no
 * identity through to Permit).
 */
export function requirePermit(
  resource: string,
  action: string,
  resourceKeyOf?: (req: Request) => string | undefined,
) {
  return async function permitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No credential, or a credential that is not valid.' });
      return;
    }

    const tenant = req.orgId ?? 'platform';
    try {
      const key = resourceKeyOf ? resourceKeyOf(req) : undefined;
      const resourceInstance = key ? { type: resource, tenant, key } : { type: resource, tenant };

      const allowed: boolean = await _permitClient.check(userId, action, resourceInstance);
      if (!allowed) {
        // The response does not reveal whether the requested scope/namespace
        // exists (openapi.yaml `Forbidden` response) — a generic denial only.
        res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
        return;
      }
      next();
    } catch (err) {
      // Fail CLOSED: a Permit.io error must never grant access.
      // eslint-disable-next-line no-console
      console.error('[permit] Permit.io check threw — failing closed.', { err, userId, resource, action });
      res.status(403).json({ code: 'FORBIDDEN', message: 'Authorization service unavailable.' });
    }
  };
}
