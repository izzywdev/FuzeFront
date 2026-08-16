import { CustomerService } from '../../src/services/customer.service';
import { CustomerRepository } from '../../src/repositories/customer.repository';
import { BillingCustomer, EntityType } from '../../src/types';

/** In-memory fake repo — no Postgres needed. */
class FakeCustomerRepo implements CustomerRepository {
  rows: BillingCustomer[] = [];
  private seq = 0;

  async findByEntity(entityType: EntityType, entityId: string) {
    return (
      this.rows.find((r) => r.entityType === entityType && r.entityId === entityId) ?? null
    );
  }

  async findByStripeCustomerId(stripeCustomerId: string) {
    return this.rows.find((r) => r.stripeCustomerId === stripeCustomerId) ?? null;
  }

  async insert(row: { entityType: EntityType; entityId: string; stripeCustomerId: string }) {
    const created: BillingCustomer = { id: `cust_${++this.seq}`, ...row };
    this.rows.push(created);
    return created;
  }
}

describe('CustomerService.ensureCustomer', () => {
  it('creates a Stripe customer on first call and persists the mapping', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_stripe_1' });
    const stripe = { customers: { create } } as any;
    const svc = new CustomerService(stripe, repo);

    const result = await svc.ensureCustomer('user', 'user-1', { email: 'a@b.com' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.stripeCustomerId).toBe('cus_stripe_1');
    expect(result.entityType).toBe('user');
    expect(repo.rows).toHaveLength(1);
  });

  it('returns the existing mapping without calling Stripe on the second call', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_stripe_1' });
    const stripe = { customers: { create } } as any;
    const svc = new CustomerService(stripe, repo);

    const first = await svc.ensureCustomer('organization', 'org-1');
    const second = await svc.ensureCustomer('organization', 'org-1');

    expect(create).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(repo.rows).toHaveLength(1);
  });

  it('keys the Stripe customer on the dual entity via metadata + idempotency key', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_org' });
    const stripe = { customers: { create } } as any;
    const svc = new CustomerService(stripe, repo);

    await svc.ensureCustomer('organization', 'org-42');

    const [params, opts] = create.mock.calls[0];
    expect(params.metadata).toMatchObject({
      fuzefront_entity_type: 'organization',
      fuzefront_entity_id: 'org-42',
    });
    expect(opts.idempotencyKey).toBe('customer-create-organization-org-42');
  });

  it('emits tenantRegistered for a new organization customer (#491)', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_org_1' });
    const stripe = { customers: { create } } as any;
    const tenantRegistered = jest.fn().mockResolvedValue(undefined);
    const svc = new CustomerService(stripe, repo, { tenantRegistered });

    await svc.ensureCustomer('organization', 'org-1');

    expect(tenantRegistered).toHaveBeenCalledWith({
      entityId: 'org-1',
      entityType: 'organization',
      stripeCustomerId: 'cus_org_1',
    });
  });

  it('does NOT emit tenantRegistered for a personal (user) customer', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_user_1' });
    const stripe = { customers: { create } } as any;
    const tenantRegistered = jest.fn().mockResolvedValue(undefined);
    const svc = new CustomerService(stripe, repo, { tenantRegistered });

    await svc.ensureCustomer('user', 'user-1');

    expect(tenantRegistered).not.toHaveBeenCalled();
  });

  it('does NOT re-emit tenantRegistered on the idempotent second call', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_org_1' });
    const stripe = { customers: { create } } as any;
    const tenantRegistered = jest.fn().mockResolvedValue(undefined);
    const svc = new CustomerService(stripe, repo, { tenantRegistered });

    await svc.ensureCustomer('organization', 'org-1');
    await svc.ensureCustomer('organization', 'org-1');

    expect(tenantRegistered).toHaveBeenCalledTimes(1);
  });

  it('does not fail customer creation when the emitter is omitted', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_org_1' });
    const stripe = { customers: { create } } as any;
    const svc = new CustomerService(stripe, repo);

    await expect(svc.ensureCustomer('organization', 'org-1')).resolves.toBeDefined();
  });

  it('does not fail customer creation when the tenantRegistered emit rejects', async () => {
    const repo = new FakeCustomerRepo();
    const create = jest.fn().mockResolvedValue({ id: 'cus_org_1' });
    const stripe = { customers: { create } } as any;
    const tenantRegistered = jest.fn().mockRejectedValue(new Error('kafka down'));
    const svc = new CustomerService(stripe, repo, { tenantRegistered });

    const result = await svc.ensureCustomer('organization', 'org-1');
    expect(result.stripeCustomerId).toBe('cus_org_1');
  });
});
