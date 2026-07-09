import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PricingCard } from '@fuzefront/design-system'

describe('PricingCard', () => {
  it('renders tier name, price, interval and features', () => {
    render(
      <PricingCard
        tierName="Pro"
        price="$29"
        interval="month"
        features={['Unlimited apps', 'Priority support']}
      />
    )
    expect(screen.getByRole('group', { name: /Pro plan/i })).toBeInTheDocument()
    expect(screen.getByText('$29')).toBeInTheDocument()
    expect(screen.getByText('/month')).toBeInTheDocument()
    expect(screen.getByText('Unlimited apps')).toBeInTheDocument()
    expect(screen.getByText('Priority support')).toBeInTheDocument()
  })

  it('labels the recommended tier (not color alone)', () => {
    render(<PricingCard tierName="Pro" price="$29" recommended />)
    expect(screen.getByText(/recommended/i)).toBeInTheDocument()
  })

  it('disables the CTA and labels the current plan', () => {
    const onSelect = vi.fn()
    render(<PricingCard tierName="Pro" price="$29" current onSelect={onSelect} />)
    const card = screen.getByRole('group', { name: /Pro plan/i })
    expect(card).toHaveAttribute('aria-current', 'true')
    const cta = screen.getByRole('button', { name: /current plan/i })
    expect(cta).toBeDisabled()
    fireEvent.click(cta)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('fires onSelect when the CTA is pressed', () => {
    const onSelect = vi.fn()
    render(
      <PricingCard tierName="Pro" price="$29" ctaLabel="Subscribe" onSelect={onSelect} />
    )
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows a busy CTA and does not fire onSelect while busy', () => {
    const onSelect = vi.fn()
    render(<PricingCard tierName="Pro" price="$29" busy onSelect={onSelect} />)
    const cta = screen.getByRole('button')
    expect(cta).toBeDisabled()
    fireEvent.click(cta)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
