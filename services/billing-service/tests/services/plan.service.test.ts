import { PlanService } from '../../src/services/plan.service';
import { PlanRepository } from '../../src/repositories/plan.repository';
import { Plan } from '../../src/types';

class FakePlanRepo implements PlanRepository {
  plans: Plan[] = [];
  upsertCalls = 0;
  listCalls = 0;

  async upsert(plan: Plan) {
    this.upsertCalls++;
    const i = this.plans.findIndex((p) => p.priceId === plan.priceId);
    if (i >= 0) this.plans[i] = plan;
    else this.plans.push(plan);
  }
  async listActive() {
    this.listCalls++;
    return this.plans.filter((p) => p.isActive);
  }
  async findByPriceId(id: string) {
    return this.plans.find((p) => p.priceId === id) ?? null;
  }
}

function stripeWithPrices(data: any[]) {
  return { prices: { list: jest.fn().mockResolvedValue({ data }) } } as any;
}

describe('PlanService.syncPlans', () => {
  it('upserts each active Stripe price into the plan repo', async () => {
    const repo = new FakePlanRepo();
    const stripe = stripeWithPrices([
      {
        id: 'price_growth_1',
        active: true,
        unit_amount: 9900,
        currency: 'usd',
        recurring: { interval: 'month', usage_type: 'licensed' },
        product: {
          id: 'prod_growth_1',
          name: 'Growth',
          metadata: { tier_name: 'growth', seat_based: 'true', sort_order: '2', features: '["a","b"]' },
        },
      },
    ]);
    const svc = new PlanService(stripe, repo);

    const count = await svc.syncPlans();

    expect(count).toBe(1);
    expect(repo.plans[0]).toMatchObject({
      priceId: 'price_growth_1',
      productId: 'prod_growth_1',
      tierName: 'growth',
      seatBased: true,
      billingInterval: 'month',
      unitAmount: 9900,
      sortOrder: 2,
      features: ['a', 'b'],
    });
  });

  it('normalizes legacy tier names to canonical equivalents on sync', async () => {
    const repo = new FakePlanRepo();
    const stripe = stripeWithPrices([
      {
        id: 'price_legacy_professional',
        active: true,
        unit_amount: 9900,
        currency: 'usd',
        recurring: { interval: 'month', usage_type: 'licensed' },
        product: {
          id: 'prod_legacy',
          name: 'Professional',
          metadata: { tier_name: 'professional', sort_order: '2' },
        },
      },
    ]);
    const svc = new PlanService(stripe, repo);

    await svc.syncPlans();

    // 'professional' is a LEGACY_TIER_MAP entry → normalized to 'growth'
    expect(repo.plans[0].tierName).toBe('growth');
  });

  it('marks metered prices with the meter name from product metadata', async () => {
    const repo = new FakePlanRepo();
    const stripe = stripeWithPrices([
      {
        id: 'price_metered',
        active: true,
        unit_amount: 0,
        currency: 'usd',
        recurring: { interval: 'month', usage_type: 'metered' },
        product: { id: 'prod_m', name: 'Usage', metadata: { meter_name: 'api_calls' } },
      },
    ]);
    const svc = new PlanService(stripe, repo);
    await svc.syncPlans();
    expect(repo.plans[0].meteredMeterName).toBe('api_calls');
  });
});

describe('PlanService.getActivePlans', () => {
  it('serves from cache within TTL (repo hit once)', async () => {
    const repo = new FakePlanRepo();
    repo.plans = [
      { priceId: 'p1', productId: 'pr1', tierName: 'starter', displayName: 'Starter', billingInterval: 'month', unitAmount: 900, currency: 'usd', seatBased: false, meteredMeterName: null, features: [], isActive: true, sortOrder: 1 },
    ];
    let t = 1000;
    const svc = new PlanService({} as any, repo, 60_000, () => t);

    await svc.getActivePlans();
    t += 1000; // within TTL
    await svc.getActivePlans();

    expect(repo.listCalls).toBe(1);
  });

  it('refreshes from repo after TTL expiry', async () => {
    const repo = new FakePlanRepo();
    repo.plans = [
      { priceId: 'p1', productId: 'pr1', tierName: 'starter', displayName: 'Starter', billingInterval: 'month', unitAmount: 2900, currency: 'usd', seatBased: false, meteredMeterName: null, features: [], isActive: true, sortOrder: 1 },
    ];
    let t = 0;
    const svc = new PlanService({} as any, repo, 60_000, () => t);

    await svc.getActivePlans();
    t += 61_000; // past TTL
    await svc.getActivePlans();

    expect(repo.listCalls).toBe(2);
  });

  it('returns empty array and logs a warning when billing.plans is empty', async () => {
    const repo = new FakePlanRepo(); // no plans seeded
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new PlanService({} as any, repo, 60_000, () => 0);

    const plans = await svc.getActivePlans();

    expect(plans).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('billing.plans is empty'),
    );
    expect(repo.listCalls).toBe(1);
    warnSpy.mockRestore();
  });

  it('re-throws DB errors without serving a fallback', async () => {
    const repo = new FakePlanRepo();
    const dbError = new Error('connection refused');
    jest.spyOn(repo, 'listActive').mockRejectedValue(dbError);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const svc = new PlanService({} as any, repo, 60_000, () => 0);

    await expect(svc.getActivePlans()).rejects.toThrow('connection refused');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('DB error reading billing.plans'),
      dbError,
    );
    errorSpy.mockRestore();
  });

  it('invalidates cache after a sync', async () => {
    const repo = new FakePlanRepo();
    repo.plans = [
      { priceId: 'p1', productId: 'pr1', tierName: 'starter', displayName: 'Starter', billingInterval: 'month', unitAmount: 2900, currency: 'usd', seatBased: false, meteredMeterName: null, features: [], isActive: true, sortOrder: 1 },
    ];
    const stripe = stripeWithPrices([]);
    let t = 0;
    const svc = new PlanService(stripe, repo, 60_000, () => t);

    await svc.getActivePlans(); // populate cache (listCalls=1)
    await svc.syncPlans(); // invalidates
    await svc.getActivePlans(); // must re-read (listCalls=2)

    expect(repo.listCalls).toBe(2);
  });
});
