import type { ReactNode } from 'react'
import { AuthCard } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InvitationResolveResult } from '../../../api/invitationsClient'
import { OrgHeading } from './InvitationSummary'

export interface InvitationSignupPanelProps {
  resolved: InvitationResolveResult
  /**
   * The sign-up form itself — the host mounts `@fuzefront/auth-ui`'s `AuthPanel`
   * here (compact, signup-only, `bindToken` forwarded). identity-ui never imports
   * the auth transport; this slot is the only seam.
   */
  children: ReactNode
}

/**
 * Step 1 of accept → sign up → bind (frames/04-accept-signup-bind.html): the
 * org + role context above the host-supplied sign-up form (Google / Facebook /
 * email). The invite binding itself (the `bindToken`) is carried by the form's
 * transport — this panel only frames it. `[data-panel="accept-signup"]`.
 */
export function InvitationSignupPanel({ resolved, children }: InvitationSignupPanelProps) {
  const { messages, t } = useIdentityI18n()
  const a = messages.invitationsV2.accept
  const { invitation, organization } = resolved
  return (
    <AuthCard maxWidth="30rem" data-panel="accept-signup">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <OrgHeading
          orgName={organization.name}
          lead={t(a.signupLead, { orgName: organization.name, role: messages.roles[invitation.role] })}
          title={a.signupTitle}
        />
        {children}
      </div>
    </AuthCard>
  )
}
