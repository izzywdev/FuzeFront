// authzGateway.ts — the single `permit.check`-shaped entry point
// `agent/executor.ts` (and any future agent-tool check) should depend on.
//
// Selects between the two `PermitCheck` implementations per the
// `fuzefront.authz.chat-agent-security-api` flag (agent/authzFlag.ts):
//   OFF (default) -> `direct`  (agent/permit.ts's PermitClient, unchanged)
//   ON            -> `wrapped` (agent/securityApiPermitAdapter.ts)
//
// This is the whole FuzeFront#254 rollout mechanism for chat-service: the
// flag is the only thing that changes which implementation answers the
// question, so flipping it is reversible without a deploy, and the direct-PDP
// path is never removed until the wrapped path is proven (see the
// DEPRECATION NOTE in permit.ts).
//
// Fail-closed end-to-end: both branches already fail closed on their own; the
// flag lookup itself also fails closed to `direct` (today's behavior) per
// `isSecurityApiAuthzEnabled`'s own contract — a flag-evaluation error can
// never silently swap which policy path is used mid-incident.

import type { PermitCheck } from './permit';
import { isSecurityApiAuthzEnabled, type AuthzFlagContext } from './authzFlag';

export interface AuthzCheckable {
  check(check: PermitCheck): Promise<boolean>;
}

export class AuthzGateway implements AuthzCheckable {
  constructor(
    private readonly direct: AuthzCheckable,
    private readonly wrapped: AuthzCheckable,
    private readonly isWrappedEnabled: (
      ctx: AuthzFlagContext,
    ) => Promise<boolean> = isSecurityApiAuthzEnabled,
  ) {}

  async check(check: PermitCheck): Promise<boolean> {
    // Belt-and-braces on top of `isSecurityApiAuthzEnabled`'s own fail-safe:
    // even an INJECTED flag lookup (tests, or a future caller) that throws
    // must resolve to the unchanged direct path, never propagate out of this
    // gateway. The one path this method is never allowed to take is "flag
    // lookup failed, so assume the flag was ON."
    let useWrapped = false;
    try {
      useWrapped = await this.isWrappedEnabled({
        userId: check.user,
        orgId: check.tenant,
      });
    } catch {
      useWrapped = false;
    }
    const impl = useWrapped ? this.wrapped : this.direct;
    return impl.check(check);
  }
}
