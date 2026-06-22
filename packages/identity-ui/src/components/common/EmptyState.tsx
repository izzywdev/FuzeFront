import { Button, SeamDivider } from '@fuzefront/design-system'

export type EmptyStateVariant =
  | 'empty-members'
  | 'no-pending'
  | 'no-tokens'
  | 'error'
  | 'loading'
  | 'no-orgs'

export interface EmptyStateProps {
  variant: EmptyStateVariant
  /** Optional title override; falls back to the variant default supplied by the caller via `message`. */
  title?: string
  message?: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * Consistent empty / loading / error rendering for identity views. Uses a
 * dashed seam-toned box for empties, the SeamDivider shimmer for loading, and
 * a solid card for errors. All tokens come from the design system.
 */
export function EmptyState({ variant, title, message, actionLabel, onAction }: EmptyStateProps) {
  if (variant === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-12) var(--space-6)',
        }}
      >
        <div style={{ width: '60%', maxWidth: 320 }}>
          <SeamDivider />
        </div>
        {message && (
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            {message}
          </span>
        )}
      </div>
    )
  }

  const isError = variant === 'error'

  return (
    <div
      role={isError ? 'alert' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-12) var(--space-6)',
        borderRadius: 'var(--radius-lg)',
        border: isError ? '1px solid var(--border-color)' : '2px dashed var(--border-color)',
        background: isError ? 'var(--bg-tertiary)' : 'transparent',
        boxShadow: isError ? 'var(--shadow-xs)' : 'none',
      }}
    >
      {title && (
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-xl)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h3>
      )}
      {message && (
        <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {message}
        </p>
      )}
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
