import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@fuzefront/i18n'
import type { Plan } from '@fuzefront/billing-client'
import { billingMessages } from '../../messages'

vi.mock('@fuzefront/design-system', () => import('./ds-mock'))

import { PlanCard } from '../PlanCard'

const proPlan: Plan = {
  stripePriceId: 'price_pro',
  stripeProductId: 'prod_pro',
  tierName: 'pro',
  displayName: 'Pro',
  billingInterval: 'month',
  unitAmount: 2900,
  currency: 'usd',
  seatBased: true,
  meteredMeterName: null,
  features: ['Unlimited apps', 'Priority support'],
  isActive: true,
  sortOrder: 2,
}

function wrap(ui: React.ReactNode, language: 'en' | 'he' = 'en') {
  return render(
    <I18nProvider language={language} messages={billingMessages}>
      {ui}
    </I18nProvider>
  )
}

describe('PlanCard', () => {
  it('renders name, formatted price, interval and features', () => {
    wrap(<PlanCard plan={proPlan} />)
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument()
    expect(screen.getByText('$29')).toBeInTheDocument()
    expect(screen.getByText(/\/ month/)).toBeInTheDocument()
    expect(screen.getByText('Unlimited apps')).toBeInTheDocument()
  })

  it('fires onSelect with the price id', async () => {
    const onSelect = vi.fn()
    wrap(<PlanCard plan={proPlan} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Choose Pro/ }))
    expect(onSelect).toHaveBeenCalledWith('price_pro')
  })

  it('disables the CTA and marks aria-current when current', () => {
    wrap(<PlanCard plan={proPlan} current />)
    const btn = screen.getByRole('button', { name: 'Current plan' })
    expect(btn).toBeDisabled()
  })

  it('shows Free for a zero-amount plan', () => {
    wrap(<PlanCard plan={{ ...proPlan, unitAmount: 0, displayName: 'Starter' }} />)
    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('translates the CTA in Hebrew (RTL locale)', () => {
    wrap(<PlanCard plan={proPlan} />, 'he')
    expect(screen.getByRole('button', { name: /בחירת Pro/ })).toBeInTheDocument()
  })
})
