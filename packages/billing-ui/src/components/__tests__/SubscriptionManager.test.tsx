import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@fuzefront/i18n'
import type { BillingSubscription } from '@fuzefront/billing-client'
import { billingMessages } from '../../messages'

vi.mock('@fuzefront/design-system', () => import('./ds-mock'))

import { SubscriptionManager } from '../SubscriptionManager'

const sub: BillingSubscription = {
  id: 'bsub_1',
  customerId: 'cust_1',
  stripeSubscriptionId: 'sub_1',
  stripePriceId: 'price_pro',
  planTier: 'pro',
  status: 'active',
  seatQuantity: 5,
  trialStart: null,
  trialEnd: null,
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
}

function wrap(ui: React.ReactNode, language: 'en' | 'he' = 'en') {
  return render(
    <I18nProvider language={language} messages={billingMessages}>
      {ui}
    </I18nProvider>
  )
}

describe('SubscriptionManager', () => {
  it('shows the tier, an online status pill, seats and renewal date', () => {
    wrap(<SubscriptionManager subscription={sub} />)
    expect(screen.getByRole('heading', { name: 'pro' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-status', 'online')
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText(/Renews on/)).toBeInTheDocument()
  })

  it('maps past_due to a degraded pill', () => {
    wrap(<SubscriptionManager subscription={{ ...sub, status: 'past_due' }} />)
    expect(screen.getByRole('status')).toHaveAttribute('data-status', 'degraded')
  })

  it('fires onChangePlan and onCancel', async () => {
    const onChangePlan = vi.fn()
    const onCancel = vi.fn()
    wrap(<SubscriptionManager subscription={sub} onChangePlan={onChangePlan} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Change plan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }))
    expect(onChangePlan).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows a disabled "cancellation scheduled" state when cancelAtPeriodEnd', () => {
    wrap(<SubscriptionManager subscription={{ ...sub, cancelAtPeriodEnd: true }} />)
    expect(screen.getByText(/Ends on/)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Cancellation scheduled' })
    expect(btn).toBeDisabled()
  })

  it('disables actions while busy', () => {
    wrap(<SubscriptionManager subscription={sub} busy />)
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeDisabled()
  })

  it('renders Hebrew strings in the RTL locale', () => {
    wrap(<SubscriptionManager subscription={sub} />, 'he')
    expect(screen.getByRole('button', { name: 'שינוי תוכנית' })).toBeInTheDocument()
  })
})
