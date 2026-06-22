import { ProgressMeter } from '@fuzefront/design-system'
import { useI18n } from '@fuzefront/i18n'

export interface UsageMeterProps {
  /** Human label for the metered dimension (e.g. "Seats", "API calls"). */
  label: string
  used: number
  /** Quota; null/undefined means unlimited (no bar, just the count). */
  limit?: number | null
  /** Warn/danger thresholds as fractions of the limit (default 0.8 / 1.0). */
  warnAt?: number
}

/**
 * Usage-based billing meter. Design-system-first: wraps the DS ProgressMeter
 * (token-only, RTL-safe — fill grows from inline-start). Picks tone by how
 * close usage is to the limit. Unlimited dimensions render a count, not a bar.
 */
export function UsageMeter({ label, used, limit, warnAt = 0.8 }: UsageMeterProps) {
  const { t } = useI18n()

  if (limit == null) {
    return (
      <div style={{ fontFamily: 'var(--font-sans)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
            {used} · {t('billing.usage.unlimited')}
          </span>
        </div>
      </div>
    )
  }

  const fraction = limit > 0 ? used / limit : 0
  const tone = fraction >= 1 ? 'danger' : fraction >= warnAt ? 'warning' : 'seam'

  return (
    <ProgressMeter
      value={used}
      max={limit}
      label={label}
      valueLabel={t('billing.usage.of', { used, limit })}
      tone={tone}
    />
  )
}
