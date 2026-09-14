import { ProgressMeter } from '@fuzefront/design-system'
import type { Quota } from '../services/api'

/** Shared quota display — home's `quota-summary` strip, playground/my-access's
 * `quota` panel. Tone escalates to warning past 80% and danger at 100%, per
 * manifest acceptanceNotes (frame 02/07/09). */
export function QuotaMeter({
  quota,
  panel,
  label = 'Sandbox calls this window',
}: {
  quota: Quota
  panel: string
  label?: string
}) {
  const pct = quota.limit > 0 ? (quota.used / quota.limit) * 100 : 0
  const tone = pct >= 100 ? 'danger' : pct > 80 ? 'warning' : 'seam'
  const exceeded = quota.used >= quota.limit

  return (
    <div data-panel={panel} data-quota-state={exceeded ? 'exceeded' : 'ok'}>
      <ProgressMeter
        value={quota.used}
        max={quota.limit}
        tone={tone}
        label={label}
        valueLabel={`${quota.used} / ${quota.limit}`}
        data-quota-used={quota.used}
        data-quota-limit={quota.limit}
      />
    </div>
  )
}
