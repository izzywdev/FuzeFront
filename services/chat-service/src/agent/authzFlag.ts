/**
 * The `fuzefront.authz.chat-agent-security-api` flag — gates chat-service's
 * agent-tool permission check between the two implementations in
 * `agent/authzGateway.ts`:
 *
 *   OFF (default) — `PermitClient` (agent/permit.ts): a direct REST call to
 *     the Permit.io PDP `/allowed` endpoint. Today's unchanged behavior.
 *   ON  — `SecurityApiPermitAdapter` (agent/securityApiPermitAdapter.ts):
 *     the same decision asked of FuzeFront's own Security API
 *     (`POST /api/v1/security/authz/check`, via `@fuzefront/auth`), which
 *     wraps Permit server-side. chat-service holds no PDP URL, no Permit SDK,
 *     no Permit credential on this path.
 *
 * Type: release. Owner: backend-engineer (FuzeFront#254 — wrap Permit behind
 * the FuzeFront Security API; consumer products must not call the PDP
 * directly). Default OFF — per the issue, the direct-PDP path stays live
 * until the wrapped path is proven in production, so flipping this flag ON
 * is a deliberate, reversible rollout step, not a code change.
 *
 * Removal criterion: once the wrapped path is enabled for 100% of
 * environments and the direct-PDP path is no longer exercised in prod,
 * delete this flag, `agent/permit.ts`'s `PermitClient`, `PERMIT_PDP_URL` /
 * `config.permitPdpUrl`, and the `direct` branch of `agent/authzGateway.ts`.
 *
 * NOTE: this flag is rollout convenience only — it selects WHICH client asks
 * the authorization question, never the answer. Both branches ask the same
 * underlying Permit-backed policy (the Security API's `PermitAuthorizationProvider`
 * evaluates against the identical PDP) and both are fail-closed. Real
 * authorization is unaffected by this flag's state.
 *
 * Read via @fuzefront/feature-flags (OpenFeature), lazily required so a
 * missing/unbuilt package degrades to the fail-safe default (OFF) rather than
 * crashing this module at import time — mirrors
 * `backend/security/src/utils/rootMembershipFlag.ts` and
 * `services/selection-list-service/src/flags.ts`.
 */

export const AUTHZ_SECURITY_API_FLAG = 'fuzefront.authz.chat-agent-security-api';

export interface AuthzFlagContext {
  userId?: string;
  orgId?: string;
  environment?: string;
}

interface FlagsClient {
  getBooleanValue(
    key: string,
    def: boolean,
    ctx?: Record<string, unknown>,
  ): Promise<boolean>;
}

// Test/DI seam — pin the flag value in unit tests without a real client.
let _injected: FlagsClient | null = null;

/** Install a test client. Pass null to restore the lazy-require path. */
export function setAuthzFlagClient(c: FlagsClient | null): void {
  _injected = c;
}

function loadFlagsClient(): FlagsClient | null {
  if (_injected) return _injected;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags');
    return typeof mod.getClient === 'function' ? mod.getClient() : null;
  } catch {
    return null;
  }
}

/**
 * Evaluates the flag for the current agent check. NEVER throws — any failure
 * (package absent, provider unreachable, evaluation error) degrades to the
 * release-flag fail-safe default: OFF (today's direct-PDP behavior,
 * unchanged).
 */
export async function isSecurityApiAuthzEnabled(
  ctx: AuthzFlagContext = {},
): Promise<boolean> {
  const client = loadFlagsClient();
  if (!client) return false;

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'chat-service',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
  };

  try {
    return await client.getBooleanValue(AUTHZ_SECURITY_API_FLAG, false, context);
  } catch {
    return false;
  }
}
