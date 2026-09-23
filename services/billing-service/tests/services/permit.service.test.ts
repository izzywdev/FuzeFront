import { PermitSyncService } from '../../src/services/permit.service';

const FLAG_ENV_KEY = 'FUZEFRONT_BILLING_AUTHZ_ENABLED';

function makeAuthzClient(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    check: jest.fn(),
    bulkCheck: jest.fn(),
    grant: jest.fn(),
    revoke: jest.fn(),
    listGrants: jest.fn(),
    setAttributes: jest.fn().mockResolvedValue({
      subject: { type: 'user', key: 'user-1' },
      attributes: {},
      updatedAt: Date.now(),
    }),
    ...overrides,
  } as any;
}

describe('PermitSyncService.syncPlanToPermit', () => {
  const originalFlag = process.env[FLAG_ENV_KEY];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[FLAG_ENV_KEY];
    else process.env[FLAG_ENV_KEY] = originalFlag;
  });

  describe('flag OFF (default) — dark deploy', () => {
    beforeEach(() => {
      delete process.env[FLAG_ENV_KEY];
    });

    it('does NOT call the Security API and returns false', async () => {
      const authz = makeAuthzClient();
      const getToken = jest.fn().mockResolvedValue('tok');
      const logger = { error: jest.fn(), warn: jest.fn() };
      const svc = new PermitSyncService(authz, getToken, logger);

      const ok = await svc.syncPlanToPermit({
        entityType: 'user',
        entityId: 'user-1',
        planTier: 'pro',
        status: 'active',
      });

      expect(ok).toBe(false);
      expect(authz.setAttributes).not.toHaveBeenCalled();
      expect(getToken).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('flag ON', () => {
    beforeEach(() => {
      process.env[FLAG_ENV_KEY] = 'true';
    });

    it('updates a user subject (subject.type "user") for user entity', async () => {
      const authz = makeAuthzClient();
      const getToken = jest.fn().mockResolvedValue('tok-123');
      const svc = new PermitSyncService(authz, getToken);

      const ok = await svc.syncPlanToPermit({
        entityType: 'user',
        entityId: 'user-1',
        planTier: 'pro',
        status: 'active',
      });

      expect(ok).toBe(true);
      expect(authz.setAttributes).toHaveBeenCalledWith(
        {
          subject: { type: 'user', key: 'user-1' },
          attributes: { plan_tier: 'pro', plan_status: 'active' },
        },
        'tok-123',
      );
    });

    it('updates a tenant subject (subject.type "tenant") for organization entity, with seat_limit as a NUMBER', async () => {
      const authz = makeAuthzClient();
      const getToken = jest.fn().mockResolvedValue('tok-456');
      const svc = new PermitSyncService(authz, getToken);

      await svc.syncPlanToPermit({
        entityType: 'organization',
        entityId: 'org-1',
        planTier: 'enterprise',
        status: 'active',
        seatQuantity: 25,
      });

      expect(authz.setAttributes).toHaveBeenCalledWith(
        {
          subject: { type: 'tenant', key: 'org-1' },
          attributes: { plan_tier: 'enterprise', plan_status: 'active', seat_limit: 25 },
        },
        'tok-456',
      );
      const call = authz.setAttributes.mock.calls[0][0];
      expect(typeof call.attributes.seat_limit).toBe('number');
    });

    it('swallows a thrown setAttributes and returns false (never throws)', async () => {
      const authz = makeAuthzClient({
        setAttributes: jest.fn().mockRejectedValue(new Error('security API down')),
      });
      const getToken = jest.fn().mockResolvedValue('tok');
      const logger = { error: jest.fn(), warn: jest.fn() };
      const svc = new PermitSyncService(authz, getToken, logger);

      const ok = await svc.syncPlanToPermit({
        entityType: 'user',
        entityId: 'user-1',
        planTier: 'pro',
        status: 'active',
      });

      expect(ok).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('swallows a thrown token fetch and returns false (never throws)', async () => {
      const authz = makeAuthzClient();
      const getToken = jest.fn().mockRejectedValue(new Error('machine token unavailable'));
      const logger = { error: jest.fn(), warn: jest.fn() };
      const svc = new PermitSyncService(authz, getToken, logger);

      const ok = await svc.syncPlanToPermit({
        entityType: 'user',
        entityId: 'user-1',
        planTier: 'pro',
        status: 'active',
      });

      expect(ok).toBe(false);
      expect(authz.setAttributes).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
