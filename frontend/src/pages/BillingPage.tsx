import React, { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Badge,
  DataTable,
  PricingCard,
  Skeleton,
  Tabs,
} from '@fuzefront/design-system'
import { InvoiceHistoryPanel, BillingI18nProvider } from '@fuzefront/billing-ui'
// The billing-ui stylesheet (design-system tokens only). Imported from source
// here because the frontend build resolves @fuzefront/billing-ui from source
// (see frontend/vite.config.ts) and the published `./styles.css` subpath is not
// aliased for dev. Wiring a `@fuzefront/billing-ui/styles.css` vite alias
// (mirroring @fuzefront/chat-ui) is a follow-up owned by devops.
import '../../../packages/billing-ui/src/styles/billing-ui.css'
import { useOrganizations } from '../lib/shared'
import {
  listPlans,
  getSubscription,
  createCheckoutSession,
  listInvoices,
  createBillingPortalSession,
  formatPlanAmount,
  planInterval,
  formatInvoiceAmount,
  type BillingPlan,
  type BillingSubscriptionView,
  type BillingInvoice,
} from '../services/billingService'

/**
 * Gate for the design-system-first invoice history panel
 * (`fuzefront.billing.invoice-history`, default OFF). The family flag standard
 * is Unleash via `@fuzefront/feature-flags`; until the web flag client is
 * initialized in the shell bootstrap this reads a build-time override and
 * defaults OFF, so production behavior is unchanged. Swap the body for
 * `getBoolean('fuzefront.billing.invoice-history', false)` once the web client
 * is wired — the flag key and default stay identical.
 */
function useInvoiceHistoryFlag(): boolean {
  return import.meta.env.VITE_FF_BILLING_INVOICE_HISTORY === 'true'
}

/**
 * Billing area for the FuzeFront shell — an industry-standard, design-system-
 * first surface split into three tabs:
 *
 *   • Plans    — a responsive pricing-card grid (recommended tier, current-plan
 *                state, skeleton/empty/error), subscribing via Stripe HOSTED
 *                Checkout (the card is entered on Stripe's page; we never touch
 *                PCI data).
 *   • Invoices — the org's Stripe invoices (date / number / amount / status +
 *                hosted-invoice & PDF links), cursor-paginated.
 *   • Payments — payment-method management + history via a Stripe Billing
 *                Customer Portal session ("Manage billing"), the industry-
 *                standard PCI-free way to expose this.
 *
 * Each tab is a real route (`/billing`, `/billing/invoices`,
 * `/billing/payments`) so the section is linkable and back/forward works; the
 * Tabs strip drives navigation. All calls go through the same-origin host
 * proxy (`/api/v1/billing/*`), org-scoped + BOLA-authorized server-side.
 */

type BillingTab = 'plans' | 'invoices' | 'payments'

const TAB_PATHS: Record<BillingTab, string> = {
  plans: '/billing',
  invoices: '/billing/invoices',
  payments: '/billing/payments',
}

function tabFromPath(pathname: string): BillingTab {
  if (pathname.startsWith('/billing/invoices')) return 'invoices'
  if (pathname.startsWith('/billing/payments')) return 'payments'
  return 'plans'
}

/** Whether `plan` is the entity's current subscription (defensive matching). */
function isCurrentPlan(
  subscription: BillingSubscriptionView | undefined,
  plan: BillingPlan
): boolean {
  if (!subscription) return false
  const planId = (plan.id || plan.stripePriceId || plan.priceId) as
    | string
    | undefined
  const subPriceId = (subscription.priceId ?? subscription.planId) as
    | string
    | undefined
  if (planId && subPriceId && planId === subPriceId) return true
  const planName = plan.displayName || plan.name
  return Boolean(
    planName && subscription.planName && planName === subscription.planName
  )
}

const BillingPage: React.FC = () => {
  const { activeOrganizationId } = useOrganizations()
  const organizationId = activeOrganizationId ?? undefined
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = tabFromPath(location.pathname)

  const [subscription, setSubscription] = useState<
    BillingSubscriptionView | undefined
  >()

  // The current subscription is shared across tabs (summary + current-plan
  // state). Best-effort: a missing subscription is a normal new-org state.
  useEffect(() => {
    let cancelled = false
    getSubscription(organizationId)
      .then(s => {
        if (!cancelled) setSubscription(s)
      })
      .catch(() => {
        if (!cancelled) setSubscription(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [organizationId])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Billing</h1>
        <p>Manage your plan, invoices, and payment methods.</p>
      </div>

      {subscription && (
        <section
          aria-labelledby="cur-sub"
          style={{ marginBottom: 'var(--space-6)' }}
        >
          <h2 id="cur-sub" style={{ marginTop: 0 }}>
            Your subscription
          </h2>
          <div
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
            }}
          >
            <strong>{subscription.planName || 'Subscription'}</strong>
            {subscription.status && (
              <Badge
                tone={subscription.status === 'active' ? 'success' : 'neutral'}
                dot
              >
                {subscription.status}
              </Badge>
            )}
            {subscription.currentPeriodEnd && (
              <span style={{ color: 'var(--text-secondary)' }}>
                {subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
        </section>
      )}

      <Tabs
        ariaLabel="Billing sections"
        value={activeTab}
        onChange={(value: string) => navigate(TAB_PATHS[value as BillingTab])}
        tabs={[
          { value: 'plans', label: 'Plans', controls: 'billing-panel' },
          { value: 'invoices', label: 'Invoices', controls: 'billing-panel' },
          { value: 'payments', label: 'Payments', controls: 'billing-panel' },
        ]}
        style={{ marginBottom: 'var(--space-6)' }}
      />

      <div
        id="billing-panel"
        role="tabpanel"
        aria-label={`${activeTab} panel`}
        tabIndex={-1}
      >
        {activeTab === 'plans' && (
          <PlansTab organizationId={organizationId} subscription={subscription} />
        )}
        {activeTab === 'invoices' && (
          <InvoicesTab organizationId={organizationId} />
        )}
        {activeTab === 'payments' && (
          <PaymentsTab organizationId={organizationId} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plans tab — responsive pricing-card grid.
// ---------------------------------------------------------------------------

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 'var(--space-4)',
}

const PlansTab: React.FC<{
  organizationId?: string
  subscription?: BillingSubscriptionView
}> = ({ organizationId, subscription }) => {
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [busyPlanId, setBusyPlanId] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    listPlans()
      .then(p => {
        if (!cancelled) setPlans(p)
      })
      .catch(() => {
        if (cancelled) return
        setPlans([])
        setError('Billing is not available right now. Please try again shortly.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Recommended tier: honor an explicit `highlighted` flag; otherwise fall back
  // to the highest-priced plan (the common "best value" highlight).
  const recommendedId = (() => {
    const flagged = plans.find(p => p.highlighted)
    if (flagged) return (flagged.id || flagged.stripePriceId) as string | undefined
    if (plans.length < 2) return undefined
    let best: BillingPlan | undefined
    for (const p of plans) {
      const cents = p.priceCents ?? p.unitAmount ?? -1
      const bestCents = best ? best.priceCents ?? best.unitAmount ?? -1 : -1
      if (cents > bestCents) best = p
    }
    return best ? ((best.id || best.stripePriceId) as string) : undefined
  })()

  const subscribe = async (plan: BillingPlan) => {
    const planId = (plan.id || plan.stripePriceId || plan.priceId) as string
    if (!planId) return
    setBusyPlanId(planId)
    setError(undefined)
    try {
      const session = await createCheckoutSession({
        planId,
        organizationId,
        successUrl: `${window.location.origin}/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/billing?checkout=cancel`,
      })
      if (session.url) {
        window.location.assign(session.url) // → Stripe-hosted Checkout
        return
      }
      setError('Could not start checkout. Please try again.')
    } catch {
      setError('Could not start checkout. Please try again.')
    } finally {
      setBusyPlanId(undefined)
    }
  }

  return (
    <section aria-labelledby="plans-h">
      <h2 id="plans-h" style={{ marginTop: 0 }}>
        {subscription ? 'Change plan' : 'Choose a plan'}
      </h2>

      {error && (
        <div
          role="alert"
          className="alert alert-error"
          style={{ marginBottom: 'var(--space-4)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={GRID_STYLE} aria-busy="true" aria-label="Loading plans">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
              }}
            >
              <Skeleton width="50%" height="var(--space-5)" />
              <Skeleton width="40%" height="var(--space-8)" />
              <Skeleton height="var(--space-4)" />
              <Skeleton height="var(--space-4)" />
              <Skeleton height="var(--space-8)" />
            </div>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>
          No plans are available right now.
        </p>
      ) : (
        <div style={GRID_STYLE} role="list">
          {plans.map(plan => {
            const planId = (plan.id ||
              plan.stripePriceId ||
              plan.priceId) as string
            const current = isCurrentPlan(subscription, plan)
            return (
              <div role="listitem" key={planId}>
                <PricingCard
                  tierName={plan.displayName || plan.name || planId}
                  price={formatPlanAmount(plan)}
                  interval={planInterval(plan)}
                  description={plan.description}
                  features={plan.features || []}
                  recommended={planId === recommendedId}
                  current={current}
                  ctaLabel={current ? undefined : 'Subscribe'}
                  busy={busyPlanId === planId}
                  disabled={Boolean(busyPlanId) && busyPlanId !== planId}
                  onSelect={() => subscribe(plan)}
                />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Invoices tab — cursor-paginated Stripe invoices.
// ---------------------------------------------------------------------------

const INVOICE_COLUMNS = [
  { key: 'created', header: 'Date' },
  { key: 'number', header: 'Invoice' },
  { key: 'amount', header: 'Amount', align: 'right' as const },
  { key: 'status', header: 'Status' },
  { key: 'links', header: '', align: 'right' as const },
]

function invoiceStatusTone(
  status: string
): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'paid':
      return 'success'
    case 'open':
      return 'warning'
    case 'uncollectible':
      return 'error'
    default:
      return 'neutral'
  }
}

const CELL_STYLE: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
}

const InvoicesTab: React.FC<{ organizationId?: string }> = ({
  organizationId,
}) => {
  const invoiceHistoryEnabled = useInvoiceHistoryFlag()

  // Adapter over the same-origin billing service (no absolute host) matching the
  // billing-ui InvoiceHistoryPanel's injected `listInvoices` contract.
  const fetchInvoices = useCallback(
    (opts: { limit?: number; cursor?: string }) =>
      listInvoices(organizationId, opts),
    [organizationId]
  )

  // Flag ON → the design-system-first, vendor-neutral InvoiceHistoryPanel from
  // @fuzefront/billing-ui. Flag OFF → the existing native table below.
  if (invoiceHistoryEnabled) {
    return (
      <section aria-labelledby="invoices-h">
        <h2 id="invoices-h" style={{ marginTop: 0 }}>
          Invoices
        </h2>
        <BillingI18nProvider>
          <InvoiceHistoryPanel enabled listInvoices={fetchInvoices} />
        </BillingI18nProvider>
      </section>
    )
  }

  return <LegacyInvoicesTab organizationId={organizationId} />
}

const LegacyInvoicesTab: React.FC<{ organizationId?: string }> = ({
  organizationId,
}) => {
  const [invoices, setInvoices] = useState<BillingInvoice[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const res = await listInvoices(organizationId, { limit: 20 })
      setInvoices(res.invoices)
      setNextCursor(res.nextCursor)
    } catch {
      setInvoices([])
      setNextCursor(null)
      setError('Could not load invoices. Please try again shortly.')
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const res = await listInvoices(organizationId, {
        limit: 20,
        cursor: nextCursor,
      })
      setInvoices(prev => [...prev, ...res.invoices])
      setNextCursor(res.nextCursor)
    } catch {
      setError('Could not load more invoices. Please try again shortly.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section aria-labelledby="invoices-h">
      <h2 id="invoices-h" style={{ marginTop: 0 }}>
        Invoices
      </h2>

      {error && (
        <div
          role="alert"
          className="alert alert-error"
          style={{ marginBottom: 'var(--space-4)' }}
        >
          {error}
        </div>
      )}

      <DataTable
        columns={INVOICE_COLUMNS}
        loading={loading}
        emptyState="No invoices yet."
      >
        {invoices.length > 0 && (
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id}>
                <td style={CELL_STYLE}>
                  {new Date(inv.created).toLocaleDateString()}
                </td>
                <td style={CELL_STYLE}>{inv.number || '—'}</td>
                <td style={{ ...CELL_STYLE, textAlign: 'right' }}>
                  {formatInvoiceAmount(inv.amountDue, inv.currency)}
                </td>
                <td style={CELL_STYLE}>
                  <Badge tone={invoiceStatusTone(inv.status)}>{inv.status}</Badge>
                </td>
                <td style={{ ...CELL_STYLE, textAlign: 'right' }}>
                  {inv.hostedInvoiceUrl ? (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent-color)' }}
                    >
                      View
                    </a>
                  ) : inv.invoicePdf ? (
                    <a
                      href={inv.invoicePdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent-color)' }}
                    >
                      Download
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </DataTable>

      {nextCursor && !loading && (
        <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Payments tab — Stripe Billing Customer Portal (PCI-free management).
// ---------------------------------------------------------------------------

const PaymentsTab: React.FC<{ organizationId?: string }> = ({
  organizationId,
}) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const openPortal = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const { url } = await createBillingPortalSession(
        organizationId,
        `${window.location.origin}/billing/payments`
      )
      if (url) {
        window.location.assign(url) // → Stripe Billing Customer Portal
        return
      }
      setError('Could not open the billing portal. Please try again.')
    } catch {
      setError('Could not open the billing portal. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="payments-h">
      <h2 id="payments-h" style={{ marginTop: 0 }}>
        Payments
      </h2>

      {error && (
        <div
          role="alert"
          className="alert alert-error"
          style={{ marginBottom: 'var(--space-4)' }}
        >
          {error}
        </div>
      )}

      <div className="card">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Manage your payment methods, update the card on file, and view your
          full payment history securely in the Stripe Billing portal. We never
          store your card details.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openPortal}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? 'Opening…' : 'Manage billing'}
        </button>
      </div>
    </section>
  )
}

export default BillingPage
