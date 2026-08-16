/**
 * FFRNT-255 / FF-EPIC-17-S8 — `fuzefront.platform.config-management`.
 *
 * Tests BOTH flag states (skill requirement: "a flag whose off-path is
 * untested is a rollback that fails when you need it") plus the
 * Unleash-unreachable fail-safe (AC4).
 */

import { FLAGS, isConfigManagementEnabled, setFlagClient } from '../src/flags';

afterEach(() => {
  setFlagClient(null);
});

describe('FLAGS.CONFIG_MANAGEMENT', () => {
  it('is the taxonomy-correct key', () => {
    expect(FLAGS.CONFIG_MANAGEMENT).toBe('fuzefront.platform.config-management');
  });
});

describe('isConfigManagementEnabled — OFF path', () => {
  it('defaults OFF when no flag client is available (package not wired)', async () => {
    setFlagClient(null);
    await expect(isConfigManagementEnabled()).resolves.toBe(false);
  });

  it('returns false when the injected client resolves false', async () => {
    setFlagClient({
      getBooleanValue: jest.fn().mockResolvedValue(false),
    });
    await expect(isConfigManagementEnabled({ userId: 'u1', organizationId: 'org1' })).resolves.toBe(false);
  });

  it('fails CLOSED (OFF) — release-flag convention — when Unleash/the client throws', async () => {
    setFlagClient({
      getBooleanValue: jest.fn().mockRejectedValue(new Error('Unleash unreachable')),
    });
    await expect(isConfigManagementEnabled()).resolves.toBe(false);
  });
});

describe('isConfigManagementEnabled — ON path', () => {
  it('returns true when the injected client resolves true', async () => {
    const getBooleanValue = jest.fn().mockResolvedValue(true);
    setFlagClient({ getBooleanValue });
    await expect(isConfigManagementEnabled({ userId: 'u1', organizationId: 'org1' })).resolves.toBe(true);

    expect(getBooleanValue).toHaveBeenCalledWith(
      'fuzefront.platform.config-management',
      false, // in-code default is the fail-safe (OFF), even when the caller is ON
      expect.objectContaining({ app: 'config-service', orgId: 'org1' }),
    );
  });

  it('passes environment + app context even with no user/org (system-caller path)', async () => {
    const getBooleanValue = jest.fn().mockResolvedValue(true);
    setFlagClient({ getBooleanValue });
    await isConfigManagementEnabled();

    const context = getBooleanValue.mock.calls[0][2];
    expect(context.app).toBe('config-service');
    expect(typeof context.environment).toBe('string');
  });
});
