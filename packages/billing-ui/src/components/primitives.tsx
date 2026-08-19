/**
 * Local presentational primitives that mirror the @fuzefront/design-system
 * components (Button, StatusPill, IconButton, Spinner). They render the DS
 * class contract and consume ONLY design-system token CSS variables via
 * billing-ui.css — no hard-coded colors/spacing/type. When the DS publishes a
 * consumable React package these can be swapped for direct imports without
 * moving the billing-ui component API.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { statusTone, statusLabel, type StatusTone } from '../lib/status';
import type { SubscriptionStatus } from '@fuzefront/billing-client';
import type { BillingStrings } from '../i18n';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  loading?: boolean;
  /** Allow arbitrary data-* hooks (e.g. data-action) to reach the DOM button. */
  [dataAttr: `data-${string}`]: unknown;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', block, loading, disabled, children, className, ...rest },
  ref,
) {
  const classes = [
    'ffb-btn',
    `ffb-btn--${variant}`,
    block ? 'ffb-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} className={classes} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ label }: { label?: string }) {
  return (
    <>
      <span className="ffb-spinner" aria-hidden="true" />
      {label ? <span className="ffb-visually-hidden">{label}</span> : null}
    </>
  );
}

export function StatusPill({
  status,
  strings,
}: {
  status: SubscriptionStatus;
  strings: BillingStrings;
}) {
  const tone: StatusTone = statusTone(status);
  return (
    <span className={`ffb-status ffb-status--${tone}`}>
      <span className="ffb-status__dot" aria-hidden="true" />
      {statusLabel(status, strings)}
    </span>
  );
}

/** Minimal inline check glyph used in feature lists. Decorative. */
export function CheckIcon() {
  return (
    <svg
      className="ffb-plan-card__check"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M13 4.5 6.5 11 3 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.5 4.5l9 9m0-9l-9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error';
  children: ReactNode;
}) {
  return (
    <p className={`ffb-notice ffb-notice--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}
