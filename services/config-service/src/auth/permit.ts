/**
 * Permit.io client + authorization check for config-service's write surface.
 *
 * Mirrors `services/selection-list-service/src/middleware/permit.ts`'s
 * established, working pattern:
 *  1. FAIL CLOSED: any Permit.io error -> deny. Never fail open.
 *  2. CI / unit-test no-op mode: a known CI dummy key, or NODE_ENV=test with
 *     no real-looking key, substitutes a proxy that allows everything so the
 *     suite never needs live Permit.io credentials. Tests that need to
 *     exercise a REAL denial inject a mock via `_setPermitClientForTesting`.
 *
 * Resource model for config-service:
 *   resource type: 'Config'
 *   resource key:  `${namespace}:${scopeType}:${scopeId ?? 'singleton'}`
 *     (or `${namespace}` alone for namespace/catalog-registration actions,
 *     which have no single scope yet)
 *   actions:
 *     'write'             — set/unset a non-system value
 *     'lock'               — lock/unlock a value (distinct from 'write' per
 *                            the S6 assumption: write authority at your own
 *                            scope does not imply lock authority over the
 *                            scopes beneath it)
 *     'write-system'       — any operation on an `isSystem` key (platform-only)
 *     'register-namespace' — POST /v1/namespaces
 *     'register-keys'      — PUT /v1/namespaces/{namespace}/keys
 *
 * An id is never a capability (governance/identifier-standard.md): every
 * check below is decided by Permit against the authenticated principal, not
 * by whether the caller merely supplied a scope/namespace id.
 */

import { Permit } from 'permitio';

const PERMIT_API_KEY = process.env.PERMIT_API_KEY ?? '';
const PERMIT_PDP_URL = process.env.PERMIT_PDP_URL ?? 'https://cloudpdp.api.permit.io';

/** Keys that signal "no real Permit account available" — CI / offline mode. */
const CI_DUMMY_KEYS = new Set(['ci-no-real-permit-calls', 'ci-noop', 'ci-offline-pdp-key']);

export const isNoOpMode: boolean =
  CI_DUMMY_KEYS.has(PERMIT_API_KEY) ||
  (process.env.NODE_ENV === 'test' && !PERMIT_API_KEY.startsWith('permit_key_'));

/**
 * Recursive Proxy: `.check()` -> allow; any other call/property chains into
 * another no-op Proxy. Only used in CI/test mode — see `isNoOpMode` above.
 */
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

let _permitClient: any = isNoOpMode
  ? makeNoOpProxy()
  : new Permit({ token: PERMIT_API_KEY, pdp: PERMIT_PDP_URL });

export function getPermitClient(): any {
  return _permitClient;
}

/** Test seam: swap the Permit client for a mock. Restore in `afterEach`. */
export function _setPermitClientForTesting(client: any): void {
  _permitClient = client;
}

export { makeNoOpProxy };

export type ConfigAction = 'write' | 'lock' | 'write-system' | 'register-namespace' | 'register-keys';

/**
 * Asks Permit whether `userId` may perform `action` on the config resource
 * instance named by `resourceKey`. FAIL CLOSED: any error (transport,
 * timeout, PDP unavailable) is a deny, never a silent allow.
 */
export async function checkConfigPermission(
  userId: string,
  action: ConfigAction,
  resourceKey: string,
): Promise<boolean> {
  try {
    const allowed: boolean = await _permitClient.check(userId, action, { type: 'Config', key: resourceKey });
    return Boolean(allowed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[permit] Config permission check threw — failing closed.', {
      err,
      userId,
      action,
      resourceKey,
    });
    return false;
  }
}
