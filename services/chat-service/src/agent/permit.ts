// permit.ts — thin client for the Permit.io PDP /allowed endpoint (plan §6c).
//
// chat-service checks the *caller's live permissions* before any tool executes
// (§10c). It talks to the in-cluster PDP over REST rather than the Permit SDK so
// the dependency surface stays minimal and the call is easily mockable.
//
// Fail-closed: any error (PDP down, non-2xx, network) returns `false` (deny) so
// a broken PDP can never authorize an action.
//
// DEPRECATION NOTE (FuzeFront#254 — wrap Permit behind the FuzeFront Security
// API): this direct-PDP path is the exact "consumer product calls Permit
// directly" leak #254 targets. It is kept ALIVE and UNCHANGED here as the
// fallback — `agent/authzGateway.ts` selects between this class and the
// wrapped `agent/securityApiPermitAdapter.ts` behind the
// `fuzefront.authz.chat-agent-security-api` flag (default OFF). Once the
// wrapped path is proven in production, flip the flag to ON, then delete this
// class + `PERMIT_PDP_URL`/`config.permitPdpUrl` entirely. Do not add new
// call sites against this class — use `agent/authzGateway.ts` instead.

export interface PermitConfig {
  /** PDP base URL, e.g. http://fuzefront-permit-pdp:7000 */
  pdpUrl: string;
  fetchImpl?: typeof fetch;
}

export interface PermitCheck {
  /** Caller's user key (JWT userId). */
  user: string;
  action: string;
  /** Resource type, e.g. 'organization' | 'docs' | 'chat'. */
  resource: string;
  /** Tenant key (orgId). */
  tenant: string;
  attributes?: Record<string, unknown>;
  /**
   * Caller's bearer token (JWT). Ignored by `PermitClient` (the PDP has no
   * concept of it) — carried here only so a single `PermitCheck` value can be
   * handed to EITHER implementation via `agent/authzGateway.ts`. Required by
   * `SecurityApiPermitAdapter` to authenticate the decision request as the
   * real principal (see `PendingExecution.token` in `executor.ts`).
   */
  token?: string;
}

export class PermitClient {
  private readonly pdpUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PermitConfig) {
    this.pdpUrl = config.pdpUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Return true only when the PDP explicitly allows. Fails closed otherwise. */
  async check(check: PermitCheck): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.pdpUrl}/allowed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: { key: check.user },
          action: check.action,
          resource: {
            type: check.resource,
            tenant: check.tenant,
            attributes: check.attributes ?? {},
          },
        }),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { allow?: boolean };
      return json.allow === true;
    } catch {
      return false;
    }
  }
}
