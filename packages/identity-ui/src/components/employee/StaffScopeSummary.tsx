import { StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface StaffScopeSummaryProps {
  /** `'explorer'` renders the cross-org-explorer banner (data-role="employee",
   * matching 01-org-explorer.html); `'drilldown'` renders the per-org banner
   * (02-org-drilldown.html), which names the org being viewed. */
  variant: 'explorer' | 'drilldown'
  /** Required when `variant === 'drilldown'` — the org being viewed. */
  orgName?: string
}

/**
 * The "you are operating as platform staff" banner shown at the top of both
 * the explorer and the drilldown (`.emp-banner`, `[data-panel="staff-banner"]`).
 * Only the explorer variant carries `data-role="employee"` — matches the
 * frames exactly (02-org-drilldown.html's banner omits it).
 */
export function StaffScopeSummary({ variant, orgName }: StaffScopeSummaryProps) {
  const { messages, t } = useIdentityI18n()
  const e = messages.employeeConsole

  const body =
    variant === 'explorer'
      ? e.bannerExplorer
      : t(e.bannerDrilldown, { org: orgName ?? '' })

  return (
    <StatusCallout
      tone="info"
      icon={<span aria-hidden="true">⛨</span>}
      data-panel="staff-banner"
      {...(variant === 'explorer' ? { 'data-role': 'employee' } : {})}
    >
      {body}
    </StatusCallout>
  )
}
