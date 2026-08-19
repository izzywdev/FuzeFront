import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalBillingFlow } from '../src/flows/PortalBillingFlow';
import { HttpError } from '../src/api/http';
import type { PortalBillingClient, ConnectStatus } from '../src/api/portalBillingClient';
import { makePlan, makeSubscription } from './helpers';

/** A fully-stubbed PortalBillingClient; each method fails loudly (via
 * `not-mocked`) unless the test overrides it, so a state test can never
 * accidentally pass because an unrelated call silently resolved. */
function makeClient(overrides: Partial<PortalBillingClient> = {}): PortalBillingClient {
  const notMocked = (name: string) => vi.fn(async () => {
    throw new Error(`${name} not mocked in this test`);
  });
  return {
    getPlans: notMocked('getPlans'),
    getSubscription: notMocked('getSubscription'),
    openBillingPortal: notMocked('openBillingPortal'),
    getConnectStatus: notMocked('getConnectStatus'),
    startConnectOnboarding: notMocked('startConnectOnboarding'),
    listPriceBook: notMocked('listPriceBook'),
    createPrice: notMocked('createPrice'),
    ...overrides,
  };
}

const connectActive: ConnectStatus = {
  status: 'active',
  chargesEnabled: true,
  payoutsEnabled: true,
  steps: [
    { id: 'account', title: 'Account created', status: 'done' },
    { id: 'details', title: 'Business details verified', status: 'done' },
    { id: 'charges', title: 'Charges & payouts enabled', status: 'done' },
  ],
};

const connectInProgress: ConnectStatus = {
  status: 'in-progress',
  chargesEnabled: false,
  payoutsEnabled: false,
  steps: [
    { id: 'account', title: 'Account created', status: 'done' },
    { id: 'details', title: 'Business details needed', status: 'current' },
    { id: 'charges', title: 'Charges & payouts', status: 'pending' },
  ],
};

const connectNotStarted: ConnectStatus = {
  status: 'not-started',
  chargesEnabled: false,
  payoutsEnabled: false,
  steps: [],
};

const connectRestricted: ConnectStatus = {
  status: 'restricted',
  chargesEnabled: false,
  payoutsEnabled: true,
  steps: [],
};

beforeEach(() => {
  // window.location.assign navigates for real in jsdom (noisy "not
  // implemented" errors) and `assign` is read-only on the real Location —
  // replace the whole object so redirect-driving actions are testable.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: vi.fn() },
  });
});

describe('PortalBillingFlow — platform subscription (REAL)', () => {
  it('(state: loading) shows the subscription panel busy while the initial load is in flight', () => {
    const client = makeClient({
      getSubscription: () => new Promise(() => {}),
      getPlans: () => new Promise(() => {}),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} />);
    const panel = screen.getByLabelText('Your FuzeFront subscription');
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(panel).toHaveAttribute('data-state', 'loading');
  });

  it('(state: error) shows a retry action on a non-403 load failure, and retry re-fetches', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const client = makeClient({
      getSubscription: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('network down');
        return makeSubscription();
      }),
      getPlans: vi.fn(async () => [makePlan()]),
      openBillingPortal: vi.fn(),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} />);
    await screen.findByRole('button', { name: 'Try again' });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it('(state: access-denied/403) renders the fail-closed notice on a 403 from the real endpoint and never a blank page', async () => {
    const client = makeClient({
      getSubscription: vi.fn(async () => {
        throw new HttpError(403, 'forbidden', { code: 'ORG_PERMISSION_DENIED' });
      }),
      getPlans: vi.fn(async () => []),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} />);
    const notice = await screen.findByText("You don't have access to this portal's billing");
    expect(notice).toBeInTheDocument();
    expect(screen.getByText(/not been signed out/)).toBeInTheDocument();
  });

  it('(state: access-denied/403) also fires on a 401, and console never reaches the ready billing panel', async () => {
    const client = makeClient({
      getSubscription: vi.fn(async () => {
        throw new HttpError(401, 'unauthenticated', {});
      }),
      getPlans: vi.fn(async () => []),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} />);
    await screen.findByText("You don't have access to this portal's billing");
    expect(screen.queryByText('Reseller payouts · Connect')).not.toBeInTheDocument();
  });

  it('renders no active-subscription empty state when the portal has none yet', async () => {
    const client = makeClient({
      getSubscription: vi.fn(async () => null),
      getPlans: vi.fn(async () => []),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} />);
    await screen.findByText('No active subscription');
  });

  it('renders plan/status/renewal and calls openBillingPortal + redirects on "Manage subscription"', async () => {
    const user = userEvent.setup();
    const openBillingPortal = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session/xyz' });
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      openBillingPortal,
    });
    render(<PortalBillingFlow organizationId="org_northwind" client={client} />);
    await screen.findByText('Active');
    expect(screen.getByText('Pro')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage subscription' }));
    await waitFor(() => expect(openBillingPortal).toHaveBeenCalledWith('org_northwind', expect.any(String)));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://billing.stripe.com/session/xyz'));
  });

  it('calls onViewInvoices when "View invoices" is clicked', async () => {
    const user = userEvent.setup();
    const onViewInvoices = vi.fn();
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} onViewInvoices={onViewInvoices} />);
    await user.click(await screen.findByRole('button', { name: 'View invoices' }));
    expect(onViewInvoices).toHaveBeenCalled();
  });
});

describe('PortalBillingFlow — reseller Connect / price book (ANTICIPATED, flag-gated)', () => {
  it('flag OFF (default): renders the honest placeholder and makes ZERO calls to the anticipated endpoints', async () => {
    const getConnectStatus = vi.fn();
    const listPriceBook = vi.fn();
    const startConnectOnboarding = vi.fn();
    const createPrice = vi.fn();
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus,
      listPriceBook,
      startConnectOnboarding,
      createPrice,
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled={false} />);
    await screen.findByText('Active'); // subscription finished loading
    expect(screen.getByText("Reseller payouts aren't enabled yet")).toBeInTheDocument();
    expect(screen.queryByText('Price book')).not.toBeInTheDocument();
    expect(getConnectStatus).not.toHaveBeenCalled();
    expect(listPriceBook).not.toHaveBeenCalled();
    expect(startConnectOnboarding).not.toHaveBeenCalled();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it('flag OFF: makes zero anticipated calls even while forbidden (403 gate short-circuits everything)', async () => {
    const getConnectStatus = vi.fn();
    const listPriceBook = vi.fn();
    const client = makeClient({
      getSubscription: vi.fn(async () => {
        throw new HttpError(403, 'forbidden', {});
      }),
      getPlans: vi.fn(async () => []),
      getConnectStatus,
      listPriceBook,
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await screen.findByText("You don't have access to this portal's billing");
    expect(getConnectStatus).not.toHaveBeenCalled();
    expect(listPriceBook).not.toHaveBeenCalled();
  });

  it('(state: not-onboarded) flag ON: renders the start-onboarding CTA and drives it', async () => {
    const user = userEvent.setup();
    const startConnectOnboarding = vi.fn().mockResolvedValue({ url: 'https://connect.stripe.com/setup/abc' });
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectNotStarted),
      listPriceBook: vi.fn(async () => ({ prices: [] })),
      startConnectOnboarding,
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    const cta = await screen.findByRole('button', { name: 'Start onboarding' });
    await user.click(cta);
    await waitFor(() => expect(startConnectOnboarding).toHaveBeenCalled());
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://connect.stripe.com/setup/abc'));
  });

  it('(state: in-progress) flag ON: renders the checklist and "Continue onboarding", never a false active pill', async () => {
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectInProgress),
      listPriceBook: vi.fn(async () => ({ prices: [] })),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await screen.findByRole('button', { name: 'Continue onboarding' });
    expect(screen.getByText('Business details needed')).toBeInTheDocument();
    expect(screen.queryByText('Onboarded')).not.toBeInTheDocument();
  });

  it('(state: active) flag ON: renders the completed checklist and the price book', async () => {
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectActive),
      listPriceBook: vi.fn(async () => ({ prices: [{ id: 'price_starter', planName: 'Starter', amountCents: 2900, currency: 'usd', interval: 'month', status: 'active' }] })),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await screen.findByText('Onboarded');
    expect(screen.getByText('Price book')).toBeInTheDocument();
    expect(await screen.findByText('Starter')).toBeInTheDocument();
  });

  it('(state: restricted) flag ON: renders the restricted banner with a reonboard action', async () => {
    const user = userEvent.setup();
    const startConnectOnboarding = vi.fn().mockResolvedValue({ url: 'https://connect.stripe.com/setup/def' });
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectRestricted),
      listPriceBook: vi.fn(async () => ({ prices: [] })),
      startConnectOnboarding,
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await screen.findByText('Stripe needs more from you');
    const actions = await screen.findAllByRole('button', { name: 'Continue onboarding' });
    await user.click(actions[actions.length - 1]);
    await waitFor(() => expect(startConnectOnboarding).toHaveBeenCalled());
  });

  it('(state: error) flag ON: a 404 (backend not built yet) renders the error banner with retry, not a crash', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new HttpError(404, 'not found', {});
        return connectNotStarted;
      }),
      listPriceBook: vi.fn(async () => ({ prices: [] })),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await screen.findByText("Couldn't load");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(attempts).toBe(2));
    await screen.findByRole('button', { name: 'Start onboarding' });
  });

  it('price book: a 404 load failure (backend not built yet) renders its own error + retry', async () => {
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectActive),
      listPriceBook: vi.fn(async () => {
        throw new HttpError(404, 'not found', {});
      }),
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await screen.findByText("Couldn't load your price book");
  });

  it('add-price is fail-closed while charges are not enabled (i10)', async () => {
    const user = userEvent.setup();
    const createPrice = vi.fn();
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectInProgress), // chargesEnabled: false
      listPriceBook: vi.fn(async () => ({ prices: [] })),
      createPrice,
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await user.click(await screen.findByRole('button', { name: 'Add price' }));
    expect(await screen.findByText('Finish onboarding first')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Publish price' });
    expect(submit).toBeDisabled();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it('add-price publishes when charges are enabled and appends the new row', async () => {
    const user = userEvent.setup();
    const createPrice = vi.fn().mockResolvedValue({
      id: 'price_new',
      planName: 'Growth',
      amountCents: 4900,
      currency: 'usd',
      interval: 'month',
      status: 'active',
    });
    const client = makeClient({
      getSubscription: vi.fn(async () => makeSubscription()),
      getPlans: vi.fn(async () => [makePlan()]),
      getConnectStatus: vi.fn(async () => connectActive), // chargesEnabled: true
      listPriceBook: vi.fn(async () => ({ prices: [] })),
      createPrice,
    });
    render(<PortalBillingFlow organizationId="org_1" client={client} resellerConnectEnabled />);
    await user.click(await screen.findByRole('button', { name: 'Add price' }));
    await user.type(screen.getByLabelText('Plan name'), 'Growth');
    await user.type(screen.getByLabelText('Price'), '49');
    await user.click(screen.getByRole('button', { name: 'Publish price' }));
    await waitFor(() =>
      expect(createPrice).toHaveBeenCalledWith({ planName: 'Growth', amountCents: 4900, currency: 'usd', interval: 'month' }),
    );
    await screen.findByText('Growth');
  });
});
