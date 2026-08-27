// authzFlag.test.ts — fuzefront.authz.chat-agent-security-api (FuzeFront#254).
// Verifies the release-flag fail-safe contract: OFF whenever the flags
// package/client is unavailable or errors, ON only on an explicit true from
// an injected client, and that the evaluation context carries userId/orgId
// for per-org/per-developer Unleash targeting.

import {
  AUTHZ_SECURITY_API_FLAG,
  isSecurityApiAuthzEnabled,
  setAuthzFlagClient,
} from '../../src/agent/authzFlag';

describe('isSecurityApiAuthzEnabled', () => {
  afterEach(() => {
    setAuthzFlagClient(null);
  });

  it('defaults OFF when no flag client is wired (lazy require finds nothing / package absent)', async () => {
    const enabled = await isSecurityApiAuthzEnabled({ userId: 'u1', orgId: 'org-1' });
    expect(enabled).toBe(false);
  });

  it('returns true only when the injected client explicitly resolves true', async () => {
    const getBooleanValue = jest.fn().mockResolvedValue(true);
    setAuthzFlagClient({ getBooleanValue });

    const enabled = await isSecurityApiAuthzEnabled({ userId: 'u1', orgId: 'org-1' });

    expect(enabled).toBe(true);
    expect(getBooleanValue).toHaveBeenCalledWith(
      AUTHZ_SECURITY_API_FLAG,
      false,
      expect.objectContaining({ app: 'chat-service', userId: 'u1', orgId: 'org-1' }),
    );
  });

  it('fails closed to OFF when the client throws', async () => {
    setAuthzFlagClient({ getBooleanValue: jest.fn().mockRejectedValue(new Error('unleash down')) });

    const enabled = await isSecurityApiAuthzEnabled({ userId: 'u1' });

    expect(enabled).toBe(false);
  });

  it('omits userId/orgId from the context when not supplied', async () => {
    const getBooleanValue = jest.fn().mockResolvedValue(false);
    setAuthzFlagClient({ getBooleanValue });

    await isSecurityApiAuthzEnabled();

    const ctx = getBooleanValue.mock.calls[0][2];
    expect(ctx.userId).toBeUndefined();
    expect(ctx.orgId).toBeUndefined();
  });
});
