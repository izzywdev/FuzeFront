import { useState } from 'react'
import type { Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Modal, Button } from '@fuzefront/design-system'
import { useI18n } from '@fuzefront/i18n'

/**
 * Resolve design-system token VALUES from the document so they can be handed to
 * Stripe's appearance API. Stripe renders the Payment Element inside its own
 * iframe, so `var(--token)` references don't resolve there — we must read the
 * computed token value on our side and pass the literal. This keeps the
 * embedded element on the fuse-seam tokens without hard-coding colors.
 */
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export interface CheckoutModalProps {
  open: boolean
  /** Stripe client secret from billing-client createSubscription/createSetupIntent. */
  clientSecret: string
  /** A loaded Stripe instance (loadStripe(...)). */
  stripe: Stripe | null
  /** Where the customer returns after any redirect-based payment method. */
  returnUrl: string
  onClose: () => void
  /** Called after Stripe confirms successfully (no error). */
  onSuccess?: () => void
}

/**
 * Stripe Payment Element inside the design-system Modal. Card data is collected
 * by Stripe's iframe and confirmed client-side — it never touches FuzeFront.
 * Design-system-first (Modal + Button + tokens); errors render in the DS error
 * token color. The Elements `appearance` is mapped from the fuse-seam tokens so
 * the embedded element matches the dark shell.
 */
export function CheckoutModal({
  open,
  clientSecret,
  stripe,
  returnUrl,
  onClose,
  onSuccess,
}: CheckoutModalProps) {
  const { t } = useI18n()
  if (!open) return null

  // Resolve token values for Stripe's iframe (var(--…) doesn't cross the iframe).
  const appearance = {
    theme: 'night' as const,
    variables: {
      colorPrimary: readToken('--accent-color', '#6e5cff'),
      fontFamily: readToken('--font-sans', 'Inter, system-ui, sans-serif'),
      borderRadius: readToken('--radius-md', '0.5rem'),
    },
  }

  return (
    <Modal open={open} title={t('billing.checkout.title')} onClose={onClose}>
      {stripe && clientSecret ? (
        <Elements stripe={stripe} options={{ clientSecret, appearance }}>
          <CheckoutForm returnUrl={returnUrl} onClose={onClose} onSuccess={onSuccess} />
        </Elements>
      ) : null}
    </Modal>
  )
}

interface CheckoutFormProps {
  returnUrl: string
  onClose: () => void
  onSuccess?: () => void
}

function CheckoutForm({ returnUrl, onClose, onSuccess }: CheckoutFormProps) {
  const { t } = useI18n()
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    })
    if (confirmError) {
      setError(confirmError.message ?? t('billing.checkout.error'))
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PaymentElement />
      {error && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--error-color)', fontSize: 'var(--text-sm)' }}
        >
          {error}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          {t('billing.checkout.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!stripe || submitting}>
          {submitting ? t('billing.checkout.processing') : t('billing.checkout.pay')}
        </Button>
      </div>
    </form>
  )
}
