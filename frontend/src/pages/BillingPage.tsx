import React, { useCallback, useEffect, useState } from 'react'
import { useOrganizations } from '../lib/shared'
import {
  listPlans,
  getSubscription,
  createCheckoutSession,
  formatPlanPrice,
  type BillingPlan,
  type BillingSubscriptionView,
} from '../services/billingService'

/**
 * Subscribe / Billing page for the FuzeFront shell.
 *
 * Lists plans from the same-origin host billing proxy (/api/v1/billing/*) and
 * subscribes via Stripe HOSTED Checkout: "Subscribe" gets a Stripe-hosted `url`
 * from the backend and redirects the browser to it; the card is entered on
 * Stripe's page, then Stripe returns to /billing?checkout=success.
 *
 * Deliberately self-contained (shell design-system classes, defensive plan
 * shape) so it's resilient to the still-settling billing-client/billing-ui
 * contract; the richer @fuzefront/billing-ui components can be layered in once
 * that contract is frozen.
 */
const BillingPage: React.FC = () => {
  const { activeOrganizationId } = useOrganizations()
  const organizationId = activeOrganizationId ?? undefined

  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [subscription, setSubscription] = useState<BillingSubscriptionView | undefined>()
  const [loading, setLoading] = useState(true)
  const [busyPlanId, setBusyPlanId] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const [p, s] = await Promise.all([listPlans(), getSubscription(organizationId)])
      setPlans(p)
      setSubscription(s)
    } catch {
      setError('Billing is not available right now. Please try again shortly.')
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const subscribe = async (plan: BillingPlan) => {
    const planId = (plan.id || plan.priceId) as string
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
    <div className="page">
      <div className="page-header">
        <h1>Billing</h1>
        <p>Choose a plan and manage your subscription.</p>
      </div>

      {error && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {subscription && (
        <section aria-labelledby="cur-sub" style={{ marginBottom: '1.5rem' }}>
          <h2 id="cur-sub">Your subscription</h2>
          <div className="card">
            <strong>{subscription.planName || 'Subscription'}</strong>
            {subscription.status && <span> — {subscription.status}</span>}
            {subscription.currentPeriodEnd && (
              <div>
                {subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </div>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="plans-h">
        <h2 id="plans-h">{subscription ? 'Change plan' : 'Choose a plan'}</h2>
        {loading ? (
          <p>Loading plans…</p>
        ) : plans.length === 0 ? (
          <p>No plans are available right now.</p>
        ) : (
          <div
            role="list"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
            }}
          >
            {plans.map(plan => {
              const planId = (plan.id || plan.priceId) as string
              return (
                <div role="listitem" key={planId} className="card">
                  <h3>{plan.displayName || plan.name || planId}</h3>
                  <p>{formatPlanPrice(plan)}</p>
                  {plan.description && <p>{plan.description}</p>}
                  <button
                    className="btn btn-primary"
                    onClick={() => subscribe(plan)}
                    disabled={!!busyPlanId}
                  >
                    {busyPlanId === planId ? 'Starting…' : 'Subscribe'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default BillingPage
