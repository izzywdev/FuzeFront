// securityApiPermitAdapter.ts — wraps FuzeFront's own Security API authz
// surface (`@fuzefront/auth`'s `createAuthzClient`) behind the same `check()`
// shape `agent/permit.ts`'s `PermitClient` exposes, so `agent/authzGateway.ts`
// can select between the two without either call site changing (FuzeFront#254
// — consumer products must not call the Permit PDP/cloud directly).
//
// chat-service holds NO Permit SDK, NO PDP URL, and NO Permit credential on
// this path — it knows only the in-cluster Security API base URL
// (`SECURITY_SERVICE_URL`, see config.ts). `@fuzefront/auth` is the same
// client `config-service`'s `middleware/authz.ts` already uses in production
// for its own Permit-free authorization (see that module for the precedent
// this adapter follows).
//
// Fail-closed, same discipline as `PermitClient`:
//   - No token on the check → deny (cannot authenticate the decision request
//     as the real principal; never falls back to a service-wide identity).
//   - `AuthzClient.check()` throws (`DECISION_UNAVAILABLE` — PDP-via-Security-
//     API unreachable, timeout, non-200, malformed response) → deny.
//   - Otherwise → the Security API's own `{ allow }` decision, verbatim.

import { createAuthzClient, type AuthzClient } from '@fuzefront/auth';
import type { PermitCheck } from './permit';

export interface SecurityApiPermitAdapterConfig {
  /** Base URL of FuzeFront's Security API, e.g. http://fuzefront-security:3002 */
  securityServiceUrl: string;
  /** Injectable fetch (tests / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
  /** Injectable client — test seam, bypasses `createAuthzClient` entirely. */
  client?: AuthzClient;
}

export class SecurityApiPermitAdapter {
  private readonly client: AuthzClient;

  constructor(config: SecurityApiPermitAdapterConfig) {
    this.client =
      config.client ??
      createAuthzClient({
        baseUrl: config.securityServiceUrl,
        fetch: config.fetchImpl as any,
      });
  }

  /** Same signature as `PermitClient.check` — return true only on an explicit allow. */
  async check(check: PermitCheck): Promise<boolean> {
    if (!check.token) {
      // Cannot ask the Security API to authenticate a decision with no
      // bearer token — this is a caller wiring gap, not a policy question.
      // Fail closed rather than guessing an identity.
      return false;
    }
    try {
      const decision = await this.client.check(
        {
          subject: check.user,
          tenant: check.tenant,
          resource: { type: check.resource },
          action: check.action,
          context: check.attributes,
        },
        check.token,
      );
      return decision.allow === true;
    } catch {
      // AuthzError('DECISION_UNAVAILABLE') or anything unexpected — deny.
      return false;
    }
  }
}
