// permit.ts — thin client for the Permit.io PDP /allowed endpoint (plan §6c).
//
// chat-service checks the *caller's live permissions* before any tool executes
// (§10c). It talks to the in-cluster PDP over REST rather than the Permit SDK so
// the dependency surface stays minimal and the call is easily mockable.
//
// Fail-closed: any error (PDP down, non-2xx, network) returns `false` (deny) so
// a broken PDP can never authorize an action.

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
