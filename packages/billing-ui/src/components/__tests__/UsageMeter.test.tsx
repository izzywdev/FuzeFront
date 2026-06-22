import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@fuzefront/i18n'
import { billingMessages } from '../../messages'

vi.mock('@fuzefront/design-system', () => import('./ds-mock'))

import { UsageMeter } from '../UsageMeter'

function wrap(ui: React.ReactNode) {
  return render(
    <I18nProvider language="en" messages={billingMessages}>
      {ui}
    </I18nProvider>
  )
}

describe('UsageMeter', () => {
  it('renders a progressbar with the right value/max and "used of limit"', () => {
    wrap(<UsageMeter label="Seats" used={3} limit={10} />)
    const bar = screen.getByRole('progressbar', { name: 'Seats' })
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(screen.getByText('3 of 10')).toBeInTheDocument()
  })

  it('uses the seam tone under the warn threshold', () => {
    wrap(<UsageMeter label="API" used={1} limit={10} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-tone', 'seam')
  })

  it('switches to warning at >=80% and danger at >=100%', () => {
    const { rerender } = wrap(<UsageMeter label="API" used={8} limit={10} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-tone', 'warning')
    rerender(
      <I18nProvider language="en" messages={billingMessages}>
        <UsageMeter label="API" used={10} limit={10} />
      </I18nProvider>
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-tone', 'danger')
  })

  it('renders an unlimited count (no bar) when limit is null', () => {
    wrap(<UsageMeter label="Projects" used={42} limit={null} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText(/Unlimited/)).toBeInTheDocument()
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })
})
