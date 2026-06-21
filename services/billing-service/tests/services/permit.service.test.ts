import { PermitSyncService } from '../../src/services/permit.service';

describe('PermitSyncService.syncPlanToPermit', () => {
  it('updates a user via permit.api.users.update for user entity', async () => {
    const usersUpdate = jest.fn().mockResolvedValue({});
    const tenantsUpdate = jest.fn().mockResolvedValue({});
    const permit = { api: { users: { update: usersUpdate }, tenants: { update: tenantsUpdate } } };
    const svc = new PermitSyncService(permit);

    const ok = await svc.syncPlanToPermit({
      entityType: 'user',
      entityId: 'user-1',
      planTier: 'pro',
      status: 'active',
    });

    expect(ok).toBe(true);
    expect(usersUpdate).toHaveBeenCalledWith('user-1', {
      attributes: { plan_tier: 'pro', plan_status: 'active' },
    });
    expect(tenantsUpdate).not.toHaveBeenCalled();
  });

  it('updates a tenant (with seat_limit) for organization entity', async () => {
    const usersUpdate = jest.fn();
    const tenantsUpdate = jest.fn().mockResolvedValue({});
    const permit = { api: { users: { update: usersUpdate }, tenants: { update: tenantsUpdate } } };
    const svc = new PermitSyncService(permit);

    await svc.syncPlanToPermit({
      entityType: 'organization',
      entityId: 'org-1',
      planTier: 'enterprise',
      status: 'active',
      seatQuantity: 25,
    });

    expect(tenantsUpdate).toHaveBeenCalledWith('org-1', {
      attributes: { plan_tier: 'enterprise', plan_status: 'active', seat_limit: 25 },
    });
  });

  it('swallows Permit errors and returns false (never throws)', async () => {
    const permit = {
      api: {
        users: { update: jest.fn().mockRejectedValue(new Error('permit down')) },
        tenants: { update: jest.fn() },
      },
    };
    const logger = { error: jest.fn(), warn: jest.fn() };
    const svc = new PermitSyncService(permit, logger);

    const ok = await svc.syncPlanToPermit({
      entityType: 'user',
      entityId: 'user-1',
      planTier: 'pro',
      status: 'active',
    });

    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});
