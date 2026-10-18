import type { ReactNode } from 'react'
import { AuthCard, Button, SeamDivider } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationResolveResult } from '../../../api/invitationsClient'
import { InvitationRoleTag, MemberTypeTag } from '../shared/InviteTags'
import { relativeFromNow } from '../shared/time'
import { OrgHeading, SummaryPanel, SummaryRow } from './InvitationSummary'

export interface InvitationAcceptCardProps {
  /** The resolved invitation + org (`GET /invitations/{token}`) — never client state. */
  resolved: InvitationResolveResult
  /** `anonymous` → create-account / sign-in CTAs; `authenticated` → a single Accept CTA. */
  mode: 'anonymous' | 'authenticated'
  accepting?: boolean
  /** Anonymous primary: `POST accept` (→ 202 enroll) then show the sign-up panel. */
  onCreateAccount?: () => void
  /** Anonymous secondary: route to sign-in carrying the invite. */
  onSignIn?: () => void
  /** Authenticated primary: `POST accept` with the session. */
  onAccept?: () => void
  /** An in-place failure (identity mismatch etc.) rendered above the actions. */
  notice?: ReactNode
}

/**
 * The public accept landing (design/frames/org-invitations-v2/03-accept-resolve.html):
 * the resolved invitation (org · role · member type · expiry · masked invited
 * address) with a "Create account & accept" primary and a "sign in to accept"
 * alternative. Role and member type come from the preview record. The address is
 * masked server-side; the token is opaque and never shown.
 * `[data-panel="accept-resolve"]`, summary `[data-panel="invite-summary"]`.
 */
export function InvitationAcceptCard({
  resolved,
  mode,
  accepting = false,
  onCreateAccount,
  onSignIn,
  onAccept,
  notice,
}: InvitationAcceptCardProps) {
  const { messages, locale, t } = useIdentityI18n()
  const a = messages.invitationsV2.accept
  const { invitation, organization } = resolved
  const expires = relativeFromNow(invitation.expiresAt, locale)

  return (
    <AuthCard maxWidth="30rem" data-panel="accept-resolve">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <OrgHeading orgName={organization.name} lead={a.lead} title={organization.name} />

        <SummaryPanel panel="invite-summary">
          <SummaryRow label={a.summaryOrg}>
            <span data-value="org">{organization.name}</span>
          </SummaryRow>
          <SummaryRow label={a.summaryRole}>
            <InvitationRoleTag role={invitation.role} hook="role" />
          </SummaryRow>
          <SummaryRow label={a.summaryMemberType}>
            <MemberTypeTag memberType={invitation.memberType} hook="member-type" />
          </SummaryRow>
          {expires && (
            <SummaryRow label={a.summaryExpires}>
              <span data-value="expires">{expires}</span>
            </SummaryRow>
          )}
          <SummaryRow label={a.summaryInvitedTo}>
            <span data-value="invite-email">{invitation.maskedContact}</span>
          </SummaryRow>
        </SummaryPanel>

        {notice}

        {mode === 'authenticated' ? (
          <Button variant="primary" fullWidth data-action="accept-continue" disabled={accepting} onClick={onAccept}>
            {accepting ? a.accepting : a.acceptCta}
          </Button>
        ) : (
          <>
            <Button variant="primary" fullWidth data-action="accept-continue" disabled={accepting} onClick={onCreateAccount}>
              {accepting ? a.accepting : a.createAndAccept}
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <SeamDivider style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{a.divider}</span>
              <SeamDivider style={{ flex: 1 }} />
            </div>
            <Button variant="ghost" fullWidth data-action="accept-signin" disabled={accepting} onClick={onSignIn}>
              {a.signInToAccept}
            </Button>
          </>
        )}

        <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {t(a.terms, { contact: invitation.maskedContact })}
        </p>
      </div>
    </AuthCard>
  )
}
