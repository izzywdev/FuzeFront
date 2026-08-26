import { InfoRow } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface InheritedAccessPanelProps {
  /** Display name of the acting Employee. */
  principalName: string
  /** The org being viewed — interpolated into the "membership row here" copy. */
  orgName: string
}

/**
 * "Access via platform staff (inherited)" — 02-org-drilldown.html's
 * `.emp-scope-panel`, `[data-panel="inherited-access"][data-access="inherited"]`.
 * The ONLY place inherited/derived staff access is surfaced for a customer
 * org, deliberately separate from `direct-members` (requirement #5) so a
 * tenant owner never mistakes derived access for a member.
 */
export function InheritedAccessPanel({ principalName, orgName }: InheritedAccessPanelProps) {
  const { messages, t } = useIdentityI18n()
  const e = messages.employeeConsole

  return (
    <section
      data-panel="inherited-access"
      data-access="inherited"
      aria-labelledby="inherited-access-heading"
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        background: 'var(--bg-tertiary)',
      }}
    >
      <h3
        id="inherited-access-heading"
        style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}
      >
        <span aria-hidden="true">⛨</span> {e.inheritedTitle}
      </h3>

      <InfoRow label={e.inheritedPrincipal}>{principalName} · Employee</InfoRow>
      <InfoRow label={e.inheritedSource}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{e.inheritedSourceValue}</span>
      </InfoRow>
      <InfoRow label={e.inheritedMembershipRow}>{t(e.inheritedMembershipRowValue, { org: orgName })}</InfoRow>
      <InfoRow label={e.inheritedScope}>{e.inheritedScopeValue}</InfoRow>

      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{e.inheritedFootnote}</p>
    </section>
  )
}
