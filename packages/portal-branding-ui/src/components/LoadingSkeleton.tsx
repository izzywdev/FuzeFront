import { Skeleton } from '@fuzefront/design-system'

/**
 * The neutral boot skeleton (frame 05, `data-state="loading"`) — token-colored
 * shapes only, NO text nodes. That is deliberate, not an oversight: the
 * no-flash contract (FF-EPIC-10-S2 AC3) requires the shell never paint the
 * default FuzeFront brand name before the tenant resolves, and a skeleton
 * with zero text content can never violate that by construction.
 */
export function LoadingSkeleton() {
  return (
    <div
      data-state="loading"
      aria-busy="true"
      aria-label="Loading workspace"
      style={{ padding: 'var(--space-6)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Skeleton width="1.875rem" height="1.875rem" radius="var(--radius-md)" />
        <Skeleton width="7.5rem" height="0.875rem" />
        <div style={{ flex: 1 }} />
        <Skeleton width="2rem" height="2rem" radius="var(--radius-pill)" />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        <Skeleton width="4.375rem" height="7.5rem" />
        <Skeleton height="7.5rem" style={{ flex: 1 }} />
      </div>
    </div>
  )
}
