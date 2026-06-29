import api from './api'

/**
 * Billing API client for the FuzeFront shell.
 *
 * All calls go through the SAME-ORIGIN host proxy at `/api/v1/billing/*`
 * (the host backend mounts the billing proxy there and forwards to the
 * cluster-internal billing-service). The browser never talks to the
 * billing-service directly.
 *
 * Checkout uses Stripe HOSTED Checkout: createCheckoutSession returns a
 * Stripe-hosted `url` the browser is redirected to; the card is entered on
 * Stripe's page (PCI-handled), then Stripe returns to successUrl.
 *
 * Types are intentionally LOCAL + loose: the generated billing-client / the
 * service `/plans` shape are still settling, so we render defensively rather
 * than couple this page to an in-flux type.
 */

// axios `api` baseURL is `/api`, so prefix with `v1/billing` → /api/v1/billing/*
const P = 'v1/billing'

export interface BillingPlan {
  id?: string
  priceId?: string
  name?: string
  displayName?: string
  description?: string
  // price may arrive as cents (priceCents/unitAmount) — render defensively
  priceCents?: number
  unitAmount?: number
  currency?: string
  interval?: string
  billingInterval?: string
  features?: string[]
  highlighted?: boolean
  [k: string]: unknown
}

export interface BillingSubscriptionView {
  id?: string
  planName?: string
  status?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd?: boolean
  [k: string]: unknown
}

export interface CheckoutSessionResponse {
  sessionId?: string
  /** Stripe-hosted Checkout URL to redirect the browser to. */
  url?: string
}

export async function listPlans(): Promise<BillingPlan[]> {
  const { data } = await api.get<{ plans?: BillingPlan[] }>(`${P}/plans`)
  return data?.plans ?? []
}

export async function getSubscription(
  organizationId?: string
): Promise<BillingSubscriptionView | undefined> {
  const { data } = await api.get<{ subscription?: BillingSubscriptionView }>(
    `${P}/subscriptions`,
    organizationId ? { params: { organizationId } } : undefined
  )
  return data?.subscription
}

export async function createCheckoutSession(input: {
  planId: string
  organizationId?: string
  successUrl?: string
  cancelUrl?: string
}): Promise<CheckoutSessionResponse> {
  const { data } = await api.post<CheckoutSessionResponse>(`${P}/checkout`, input)
  return data
}

/** Cents → "$9.00" style, defensive about which field carried the amount. */
export function formatPlanPrice(plan: BillingPlan): string {
  const cents = plan.priceCents ?? plan.unitAmount
  if (cents == null) return ''
  const amount = (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: (plan.currency || 'usd').toUpperCase(),
  })
  const per = plan.interval || plan.billingInterval
  return per ? `${amount} / ${per}` : amount
}
