import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@fuzefront/i18n'
import { billingMessages } from '../../messages'

const confirmPayment = vi.fn()

vi.mock('@fuzefront/design-system', () => import('./ds-mock'))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-stripe-elements>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
}))

import { CheckoutModal } from '../CheckoutModal'

function wrap(ui: React.ReactNode) {
  return render(
    <I18nProvider language="en" messages={billingMessages}>
      {ui}
    </I18nProvider>
  )
}

const baseProps = {
  open: true,
  clientSecret: 'pi_secret_123',
  stripe: {} as never,
  returnUrl: 'https://app.fuzefront.com/billing/return',
}

describe('CheckoutModal', () => {
  beforeEach(() => confirmPayment.mockReset())

  it('renders a dialog with the Stripe Payment Element when open', () => {
    wrap(<CheckoutModal {...baseProps} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('payment-element')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    wrap(<CheckoutModal {...baseProps} open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirms payment and calls onSuccess when Stripe returns no error', async () => {
    confirmPayment.mockResolvedValue({})
    const onSuccess = vi.fn()
    wrap(<CheckoutModal {...baseProps} onClose={vi.fn()} onSuccess={onSuccess} />)
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmParams: { return_url: baseProps.returnUrl },
        redirect: 'if_required',
      })
    )
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('shows an error alert and does not call onSuccess when Stripe errors', async () => {
    confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } })
    const onSuccess = vi.fn()
    wrap(<CheckoutModal {...baseProps} onClose={vi.fn()} onSuccess={onSuccess} />)
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('cancels via the cancel button', async () => {
    const onClose = vi.fn()
    wrap(<CheckoutModal {...baseProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
