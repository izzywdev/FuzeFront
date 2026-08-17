import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BillingSubscription, Plan } from '@fuzefront/billing-client';
import { BillingI18nProvider, type Direction } from '../i18n';
import { HttpError } from '../api/http';
import {
  createPortalBillingClient,
  type ConnectStatus,
  type CreatePriceInput,
  type PortalBillingClient,
  type PriceBookEntry,
} from '../api/portalBillingClient';
import { BillingConsolePanel } from '../components/portal/BillingConsolePanel';
import { AccessDeniedNotice } from '../components/portal/AccessDeniedNotice';
import { AddPriceModal } from '../components/portal/AddPriceModal';
import type { PlatformSubscriptionLoadState } from '../components/portal/PlatformSubscriptionCard';
import type { ConnectLoadState } from '../components/portal/ConnectOnboardingCard';
import type { PriceBookLoadState } from '../components/portal/PriceBookTable';

export interface PortalBillingFlowProps {
  /**
   * The portal's own organization id (a portal IS an org — see
   * design/frames/portal-admin-consoles/manifest.json's model-reconciliation
   * note). Required to scope the real subscription/plan calls; resolve it
   * from the host's active-portal/org context, never from a raw URL param.
   */
  organizationId: string | null | undefined;
  /**
   * `fuzefront.billing.reseller-connect` flag value (release flag, default
   * OFF). Gates the ENTIRE Connect/price-book section — while false, this
   * component makes ZERO calls to the anticipated endpoints; the platform
   * subscription (real) is unaffected and always loads.
   */
  resellerConnectEnabled?: boolean;
  /** Portal display name for the console header. */
  portalName?: string;
  /** Injected client (tests/host). Defaults to a same-origin client. */
  client?: PortalBillingClient;
  /** Bearer-token accessor for the default client. */
  getToken?: () => string | null | undefined;
  /** Stripe redirect target after the Customer Portal / Connect onboarding. Defaults to the current page URL. */
  returnUrl?: string;
  onViewInvoices?: () => void;
  locale?: string;
  dir?: Direction;
}

type SubState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; subscription: BillingSubscription | null; plans: Plan[] };

type ConnectState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: ConnectStatus };

type PriceBookState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; prices: PriceBookEntry[] };

/**
 * Flow orchestrator for `/portal/admin/billing` (design/frames/
 * portal-admin-consoles, flow `portal-billing`, FF-EPIC-14-S4).
 *
 * Loads the portal's REAL platform subscription + plans and renders every
 * approval-frame state (loading, empty, error+retry, and — via a REAL 401/
 * 403 from the Permit-gated billing proxy — the fail-closed access-denied
 * state for a caller who isn't this portal's admin). The Connect/price-book
 * section is presentational against the ANTICIPATED FF-EPIC-15 contract,
 * fully gated by `resellerConnectEnabled`: OFF makes zero calls to those
 * endpoints; ON wires the full state machine, treating any failure
 * (including the 404 that backend doesn't exist yet) as the flow's error
 * state — see api/portalBillingClient.ts for the endpoint-by-endpoint
 * real-vs-anticipated breakdown.
 */
export function PortalBillingFlow(props: PortalBillingFlowProps) {
  return (
    <BillingI18nProvider dir={props.dir ?? 'ltr'} locale={props.locale ?? 'en-US'}>
      <PortalBillingFlowInner {...props} />
    </BillingI18nProvider>
  );
}

function PortalBillingFlowInner({
  organizationId,
  resellerConnectEnabled = false,
  portalName,
  client,
  getToken,
  returnUrl,
  onViewInvoices,
}: PortalBillingFlowProps) {
  const api = useMemo(() => client ?? createPortalBillingClient({ getToken }), [client, getToken]);
  const effectiveReturnUrl = returnUrl ?? (typeof window !== 'undefined' ? window.location.href : '');

  const [subState, setSubState] = useState<SubState>({ status: 'loading' });
  const [connectState, setConnectState] = useState<ConnectState>({ status: 'idle' });
  const [priceBookState, setPriceBookState] = useState<PriceBookState>({ status: 'idle' });

  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [addPriceOpen, setAddPriceOpen] = useState(false);
  const [addPriceBusy, setAddPriceBusy] = useState(false);
  const [addPriceError, setAddPriceError] = useState<string | null>(null);

  const loadSubscription = useCallback(() => {
    if (!organizationId) {
      setSubState({ status: 'forbidden' });
      return () => {};
    }
    let cancelled = false;
    setSubState({ status: 'loading' });
    Promise.all([api.getSubscription(organizationId), api.getPlans()])
      .then(([subscription, plans]) => {
        if (cancelled) return;
        setSubState({ status: 'ready', subscription, plans });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          setSubState({ status: 'forbidden' });
          return;
        }
        setSubState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, organizationId]);

  useEffect(() => loadSubscription(), [loadSubscription]);

  // The Connect/price-book section only ever fires once the subscription
  // load has cleared the access-denied gate — a forbidden caller must see
  // ZERO data anywhere on this console, and a load error there should not
  // additionally attempt the anticipated calls.
  const gateClear = subState.status === 'ready';

  const loadConnectStatus = useCallback(() => {
    if (!resellerConnectEnabled || !gateClear) {
      setConnectState({ status: 'idle' });
      return () => {};
    }
    let cancelled = false;
    setConnectState({ status: 'loading' });
    api
      .getConnectStatus()
      .then((data) => {
        if (!cancelled) setConnectState({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setConnectState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, resellerConnectEnabled, gateClear]);

  useEffect(() => loadConnectStatus(), [loadConnectStatus]);

  const loadPriceBook = useCallback(() => {
    if (!resellerConnectEnabled || !gateClear) {
      setPriceBookState({ status: 'idle' });
      return () => {};
    }
    let cancelled = false;
    setPriceBookState({ status: 'loading' });
    api
      .listPriceBook()
      .then(({ prices }) => {
        if (!cancelled) setPriceBookState({ status: 'ready', prices });
      })
      .catch(() => {
        if (!cancelled) setPriceBookState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, resellerConnectEnabled, gateClear]);

  useEffect(() => loadPriceBook(), [loadPriceBook]);

  const handleManageSubscription = useCallback(async () => {
    if (!organizationId) return;
    setManageBusy(true);
    setManageError(null);
    try {
      const { url } = await api.openBillingPortal(organizationId, effectiveReturnUrl);
      if (url && typeof window !== 'undefined') window.location.assign(url);
    } catch {
      setManageError('Could not open the billing portal. Please try again.');
    } finally {
      setManageBusy(false);
    }
  }, [api, organizationId, effectiveReturnUrl]);

  const startOrContinueOnboarding = useCallback(async () => {
    setConnectBusy(true);
    try {
      const { url } = await api.startConnectOnboarding(effectiveReturnUrl);
      if (url && typeof window !== 'undefined') window.location.assign(url);
    } catch {
      setConnectState({ status: 'error' });
    } finally {
      setConnectBusy(false);
    }
  }, [api, effectiveReturnUrl]);

  const handleAddPrice = useCallback(
    async (input: CreatePriceInput) => {
      setAddPriceBusy(true);
      setAddPriceError(null);
      try {
        const created = await api.createPrice(input);
        setPriceBookState((prev) =>
          prev.status === 'ready' ? { status: 'ready', prices: [...prev.prices, created] } : prev,
        );
        setAddPriceOpen(false);
      } catch {
        setAddPriceError('Could not publish this price. Please try again.');
      } finally {
        setAddPriceBusy(false);
      }
    },
    [api],
  );

  if (subState.status === 'forbidden') {
    return <AccessDeniedNotice />;
  }

  const subscriptionLoadState: PlatformSubscriptionLoadState =
    subState.status === 'loading' ? 'loading' : subState.status === 'error' ? 'error' : 'ready';
  const subscription = subState.status === 'ready' ? subState.subscription : null;
  const plans = subState.status === 'ready' ? subState.plans : [];
  const matchedPlan = subscription ? plans.find((p) => p.priceId === subscription.priceId) : undefined;

  const connectLoadState: ConnectLoadState = connectState.status === 'ready' ? 'ready' : connectState.status === 'error' ? 'error' : 'loading';
  const connectStatus = connectState.status === 'ready' ? connectState.data : null;
  const chargesEnabled = connectStatus?.chargesEnabled ?? false;

  const priceBookLoadState: PriceBookLoadState =
    priceBookState.status === 'ready' ? 'ready' : priceBookState.status === 'error' ? 'error' : 'loading';
  const prices = priceBookState.status === 'ready' ? priceBookState.prices : [];

  return (
    <div data-flow="portal-billing">
      <BillingConsolePanel
        portalName={portalName}
        subscriptionLoadState={subscriptionLoadState}
        subscription={subscription}
        plan={matchedPlan}
        manageBusy={manageBusy}
        manageError={manageError}
        onManageSubscription={handleManageSubscription}
        onViewInvoices={onViewInvoices}
        onRetrySubscription={loadSubscription}
        resellerConnectEnabled={resellerConnectEnabled}
        connectLoadState={connectLoadState}
        connectStatus={connectStatus}
        connectBusy={connectBusy}
        onStartOnboarding={startOrContinueOnboarding}
        onContinueOnboarding={startOrContinueOnboarding}
        onReonboard={startOrContinueOnboarding}
        onRetryConnect={loadConnectStatus}
        priceBookLoadState={priceBookLoadState}
        prices={prices}
        onAddPrice={() => setAddPriceOpen(true)}
        onRetryPriceBook={loadPriceBook}
      />
      {resellerConnectEnabled && (
        <AddPriceModal
          open={addPriceOpen}
          onClose={() => setAddPriceOpen(false)}
          chargesEnabled={chargesEnabled}
          busy={addPriceBusy}
          error={addPriceError}
          onSubmit={handleAddPrice}
        />
      )}
    </div>
  );
}
