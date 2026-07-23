import { Skeleton } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'

/**
 * Loading placeholder for the hub: a summary row + a 2×2 card grid of shimmer
 * blocks. Decorative blocks are aria-hidden; the region is marked busy and
 * labelled so assistive tech announces the load rather than empty content.
 */
export function SecurityCardGridSkeleton() {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div
      data-state="loading"
      role="status"
      aria-busy="true"
      aria-label={m.loading.label}
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5) var(--space-6)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-5)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <Skeleton
          width="calc(var(--space-12) + var(--space-2))"
          height="calc(var(--space-12) + var(--space-2))"
          radius="var(--radius-pill)"
        />
        <div style={{ flex: 1 }}>
          <Skeleton width="52%" height="var(--space-4)" />
          <div style={{ height: 'var(--space-2)' }} />
          <Skeleton width="70%" height="var(--space-3)" />
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-4)',
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="var(--space-16)" radius="var(--radius-md)" />
        ))}
      </div>
    </div>
  )
}
