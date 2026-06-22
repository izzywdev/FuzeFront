/**
 * Lightweight stand-ins for the @fuzefront/design-system components, used by
 * the billing-ui unit tests. They preserve the public prop contract (and the
 * a11y-relevant attributes) so tests assert billing-ui's own behaviour without
 * depending on the design system's internal styling/hover handlers. The real
 * design-system integration is exercised by the library build + the host app.
 */
import type { ReactNode } from 'react'

export function Button({
  children,
  disabled,
  onClick,
  type,
  variant,
  ...rest
}: {
  children?: ReactNode
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: string
  [k: string]: unknown
}) {
  return (
    <button type={type ?? 'button'} disabled={disabled} onClick={onClick} data-variant={variant} {...rest}>
      {children}
    </button>
  )
}

export function Badge({ children }: { children?: ReactNode; tone?: string }) {
  return <span data-ds="badge">{children}</span>
}

export function StatusPill({ status, label }: { status?: string; label?: ReactNode }) {
  return (
    <span role="status" data-status={status}>
      {label}
    </span>
  )
}

export function Card({
  children,
  seam,
  ...rest
}: {
  children?: ReactNode
  seam?: boolean
  interactive?: boolean
  padded?: boolean
  [k: string]: unknown
}) {
  return (
    <div data-ds="card" data-seam={seam ? 'true' : undefined} {...rest}>
      {children}
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open?: boolean
  title?: ReactNode
  onClose?: () => void
  children?: ReactNode
}) {
  if (open === false) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <h2>{title}</h2>
      <button aria-label="Close" onClick={onClose}>
        ×
      </button>
      {children}
    </div>
  )
}

export function ProgressMeter({
  value,
  max,
  label,
  valueLabel,
  tone,
}: {
  value?: number
  max?: number
  label?: ReactNode
  valueLabel?: ReactNode
  tone?: string
}) {
  return (
    <div>
      <span>{label}</span>
      <span>{valueLabel}</span>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
        aria-label={typeof label === 'string' ? label : 'progress'}
        data-tone={tone}
      />
    </div>
  )
}

export function SeamDivider() {
  return <div data-ds="seam-divider" />
}
