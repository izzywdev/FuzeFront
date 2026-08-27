// authzGateway.test.ts — the flag-gated selector between the direct-PDP
// PermitClient and the Security-API-wrapped adapter (FuzeFront#254). Verifies
// BOTH flag states, per the flag-testing mandate: OFF (default) must reach
// the unchanged direct path; ON must reach the wrapped path and nowhere else;
// and a flag-evaluation failure must degrade to OFF (never silently swap
// paths mid-incident).

import { AuthzGateway, type AuthzCheckable } from '../../src/agent/authzGateway';
import type { PermitCheck } from '../../src/agent/permit';

function pendingCheck(overrides: Partial<PermitCheck> = {}): PermitCheck {
  return {
    user: 'user-1',
    action: 'create',
    resource: 'organization',
    tenant: 'org-1',
    token: 'tok',
    ...overrides,
  };
}

describe('AuthzGateway — flag OFF (default)', () => {
  it('delegates to the direct implementation and never touches wrapped', async () => {
    const direct: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const wrapped: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const gateway = new AuthzGateway(direct, wrapped, async () => false);

    const allowed = await gateway.check(pendingCheck());

    expect(allowed).toBe(true);
    expect(direct.check).toHaveBeenCalledTimes(1);
    expect(wrapped.check).not.toHaveBeenCalled();
  });

  it('is the default when the flag lookup itself is not overridden (isSecurityApiAuthzEnabled fail-safe)', async () => {
    const direct: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const wrapped: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    // No third arg -> real isSecurityApiAuthzEnabled, which is OFF absent a
    // wired @fuzefront/feature-flags client (see authzFlag.test.ts).
    const gateway = new AuthzGateway(direct, wrapped);

    await gateway.check(pendingCheck());

    expect(direct.check).toHaveBeenCalledTimes(1);
    expect(wrapped.check).not.toHaveBeenCalled();
  });
});

describe('AuthzGateway — flag ON', () => {
  it('delegates to the wrapped implementation and never touches direct', async () => {
    const direct: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const wrapped: AuthzCheckable = { check: jest.fn().mockResolvedValue(false) };
    const gateway = new AuthzGateway(direct, wrapped, async () => true);

    const allowed = await gateway.check(pendingCheck());

    expect(allowed).toBe(false);
    expect(wrapped.check).toHaveBeenCalledTimes(1);
    expect(direct.check).not.toHaveBeenCalled();
  });

  it('passes the flag context (userId/orgId) derived from the check', async () => {
    const isWrappedEnabled = jest.fn().mockResolvedValue(true);
    const direct: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const wrapped: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const gateway = new AuthzGateway(direct, wrapped, isWrappedEnabled);

    await gateway.check(pendingCheck({ user: 'user-9', tenant: 'org-9' }));

    expect(isWrappedEnabled).toHaveBeenCalledWith({ userId: 'user-9', orgId: 'org-9' });
  });
});

describe('AuthzGateway — flag evaluation failure', () => {
  it('falls back to the direct path and never throws out of check(), even if the injected flag lookup rejects', async () => {
    const direct: AuthzCheckable = { check: jest.fn().mockResolvedValue(true) };
    const wrapped: AuthzCheckable = { check: jest.fn() };
    const isWrappedEnabled = jest.fn().mockRejectedValue(new Error('unleash unreachable'));
    const gateway = new AuthzGateway(direct, wrapped, isWrappedEnabled);

    // A rejecting flag lookup must never surface as an exception from
    // check(), and must never be read as "the flag was ON" — production's
    // isSecurityApiAuthzEnabled already fails safe on its own (see
    // authzFlag.test.ts); this proves the gateway ALSO fails safe even if a
    // future/injected lookup does not.
    const allowed = await gateway.check(pendingCheck());

    expect(allowed).toBe(true);
    expect(direct.check).toHaveBeenCalledTimes(1);
    expect(wrapped.check).not.toHaveBeenCalled();
  });
});
