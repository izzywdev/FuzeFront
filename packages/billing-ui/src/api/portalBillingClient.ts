/**
 * Portal-admin billing API client — the data layer behind `PortalBillingFlow`
 * (design/frames/portal-admin-consoles, flow `portal-billing`, FF-EPIC-14-S4).
 *
 * REAL, wired to services/billing-service via the host-backend proxy
 * (services/billing-service/openapi.yaml, backend/src/routes/billing.ts):
 *   - GET  /api/v1/billing/plans
 *   - GET  /api/v1/billing/subscriptions?organizationId=<portalOrgId>
 *   - POST /api/v1/billing/portal
 *
 *   NOTE on a deliberate deviation from the flow's brief: the brief describes
 *   `getSubscription(id) -> GET /api/v1/billing/subscriptions/:id`. Reading
 *   the actual contract (services/billing-service/src/routes/subscriptions.ts
 *   + backend/src/routes/billing.ts) shows the proxy authorizes and resolves
 *   the CURRENT subscription for an ENTITY (`organizationId`), not by
 *   subscription id — a portal-admin console has no subscription id up front
 *   in the first place (there is no portal-service row to read one from; per
 *   the manifest's model-reconciliation note, a portal IS an org). This
 *   client follows the real, working contract instead — the SAME one
 *   `frontend/src/services/billingService.ts` already uses for the org
 *   billing page — per the task mandate to follow the code over the
 *   assumption. The GET /subscriptions/:id route exists too but requires
 *   already knowing the id, which nothing here has a source for.
 *
 *   This also DOUBLES as the fail-closed authorization gate for the whole
 *   console: `backend/src/routes/billing.ts` authorizes the caller against
 *   the target organization via Permit (`checkOrganizationPermission`)
 *   before forwarding — a caller without 'read' on the portal's org gets a
 *   REAL 403 here. `PortalBillingFlow` treats that 403 (and a 401) as the
 *   access-denied state, so "not this portal's admin" is enforced by the
 *   platform's actual authorization, not a client-side guess.
 *
 * ANTICIPATED (FF-EPIC-15-S2/S3/S5 — Stripe Connect + price book). Verified:
 * no `/portal/connect/*` or `/portal/price-book` route exists anywhere in
 * this repo today. These will 404 until that backend ships; every method
 * here just lets that HttpError propagate — PortalBillingFlow is what turns
 * it into the flow's `error` state, never a crash. Only called at all when
 * the `fuzefront.billing.reseller-connect` flag is ON (default OFF).
 *   - GET  /api/v1/portal/connect/status
 *   - POST /api/v1/portal/connect/account-link
 *   - GET  /api/v1/portal/price-book
 *   - POST /api/v1/portal/price-book
 */
import { HttpClient, type HttpClientOptions } from './http';
import type { BillingSubscription, Plan } from '@fuzefront/billing-client';

export type ConnectOnboardingStatus = 'not-started' | 'in-progress' | 'active' | 'restricted';

export interface ConnectStepState {
  id: string;
  title: string;
  description?: string;
  status: 'done' | 'current' | 'pending';
}

export interface ConnectStatus {
  /**
   * Derived client-side per the approval frame's contract note: "Onboarded"
   * is true ONLY when charges_enabled AND payouts_enabled are both true, so
   * an in-progress or restricted account is never rendered as active — a
   * false "active" here would be a money bug (09-portal-states, i7-i10).
   */
  status: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  steps: ConnectStepState[];
}

export interface PriceBookEntry {
  id: string;
  planName: string;
  amountCents: number;
  currency: string;
  interval?: string;
  status: 'active' | 'archived' | string;
}

export interface CreatePriceInput {
  planName: string;
  amountCents: number;
  currency: string;
  interval?: string;
}

export interface PortalBillingClient {
  // ---- REAL --------------------------------------------------------------
  getPlans(): Promise<Plan[]>;
  getSubscription(organizationId: string): Promise<BillingSubscription | null>;
  openBillingPortal(organizationId: string, returnUrl: string): Promise<{ url: string }>;
  // ---- ANTICIPATED (FF-EPIC-15) — session-scoped, no id/org param by design,
  // matching design/frames/portal-admin-consoles/manifest.json's anticipated
  // endpoint list ("resolved from the session, never accepted from the client").
  getConnectStatus(): Promise<ConnectStatus>;
  startConnectOnboarding(returnUrl: string): Promise<{ url: string }>;
  listPriceBook(): Promise<{ prices: PriceBookEntry[] }>;
  createPrice(input: CreatePriceInput): Promise<PriceBookEntry>;
}

const BILLING_BASE = '/api/v1/billing';
const PORTAL_BASE = '/api/v1/portal';

/**
 * Derive the UI Connect status from the raw onboarding flags. Exported so it
 * can be unit-tested directly against the frame's stated contract without
 * going through a fetch.
 */
export function deriveConnectStatus(raw: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  restricted?: boolean;
  started?: boolean;
}): ConnectOnboardingStatus {
  if (raw.restricted) return 'restricted';
  if (raw.chargesEnabled && raw.payoutsEnabled) return 'active';
  if (raw.started === false) return 'not-started';
  return 'in-progress';
}

interface RawConnectStatusResponse {
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  /** e.g. 'not_started' | 'in_progress' | 'restricted' | 'complete' — shape not frozen yet. */
  onboardingStatus?: string;
  steps?: ConnectStepState[];
}

function normalizeConnectStatus(raw: RawConnectStatusResponse): ConnectStatus {
  const chargesEnabled = raw.chargesEnabled === true;
  const payoutsEnabled = raw.payoutsEnabled === true;
  const restricted = raw.onboardingStatus === 'restricted';
  const started = raw.onboardingStatus !== 'not_started';
  const status = deriveConnectStatus({ chargesEnabled, payoutsEnabled, restricted, started });
  return {
    status,
    chargesEnabled,
    payoutsEnabled,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
  };
}

export function createPortalBillingClient(opts: HttpClientOptions = {}): PortalBillingClient {
  const http = new HttpClient(opts);
  return {
    async getPlans() {
      const res = await http.get<{ plans?: Plan[] }>(`${BILLING_BASE}/plans`);
      return res?.plans ?? [];
    },
    async getSubscription(organizationId) {
      const res = await http.get<{ subscription: BillingSubscription | null }>(
        `${BILLING_BASE}/subscriptions?organizationId=${encodeURIComponent(organizationId)}`,
      );
      return res?.subscription ?? null;
    },
    async openBillingPortal(organizationId, returnUrl) {
      return http.post<{ url: string }>(`${BILLING_BASE}/portal`, { organizationId, returnUrl });
    },
    async getConnectStatus() {
      const raw = await http.get<RawConnectStatusResponse>(`${PORTAL_BASE}/connect/status`);
      return normalizeConnectStatus(raw ?? {});
    },
    async startConnectOnboarding(returnUrl) {
      return http.post<{ url: string }>(`${PORTAL_BASE}/connect/account-link`, { returnUrl });
    },
    async listPriceBook() {
      const res = await http.get<{ prices?: PriceBookEntry[] }>(`${PORTAL_BASE}/price-book`);
      return { prices: res?.prices ?? [] };
    },
    async createPrice(input) {
      return http.post<PriceBookEntry>(`${PORTAL_BASE}/price-book`, input);
    },
  };
}
