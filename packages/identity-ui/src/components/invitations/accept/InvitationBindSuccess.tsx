import { AuthCard, Button, StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationRole, MemberType } from '../../../api/invitationsClient'
import { InvitationRoleTag, MemberTypeTag } from '../shared/InviteTags'
import { SummaryPanel, SummaryRow } from './InvitationSummary'

export interface InvitationBindSuccessProps {
  orgName: string
  /** From the returned bind result (`InvitationAcceptResult`) or, after sign-up, the resolved preview. */
  role: InvitationRole
  memberType: MemberType
  /** The signed-in account (email / display name), when the host knows it. */
  account?: string
  onGoToOrg: () => void
}

/**
 * Step 2 (frames/04-accept-signup-bind.html): the auto-bind confirmation —
 * "You're in" with org + role + member type + signed-in account and a Go-to-org
 * CTA. `[data-panel="bind-success"][data-state="bound"]`.
 */
export function InvitationBindSuccess({ orgName, role, memberType, account, onGoToOrg }: InvitationBindSuccessProps) {
  const { messages, t } = useIdentityI18n()
  const a = messages.invitationsV2.accept
  return (
    <AuthCard maxWidth="30rem" data-panel="bind-success" data-state="bound">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <StatusCallout tone="success" icon="✓" title={t(a.boundTitle, { orgName })}>
          {a.boundText}
        </StatusCallout>
        <SummaryPanel panel="bound-summary">
          <SummaryRow label={a.summaryOrg}>
            <span data-value="org">{orgName}</span>
          </SummaryRow>
          <SummaryRow label={a.summaryRole}>
            <InvitationRoleTag role={role} hook="role" />
          </SummaryRow>
          <SummaryRow label={a.summaryMemberType}>
            <MemberTypeTag memberType={memberType} hook="member-type" />
          </SummaryRow>
          {account && (
            <SummaryRow label={a.boundSignedInAs}>
              <span data-value="account">{account}</span>
            </SummaryRow>
          )}
        </SummaryPanel>
        <Button variant="primary" fullWidth data-action="go-to-org" onClick={onGoToOrg}>
          {t(a.goToOrg, { orgName })}
        </Button>
      </div>
    </AuthCard>
  )
}
