import { useMemo } from 'react'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { HttpClientOptions } from '../../../api/http'
import {
  createInvitationsClient,
  type InvitationsApiClient,
  type OrgInvitation,
} from '../../../api/invitationsClient'
import type { OrgRole } from '../../../types'
import { InvitationErrorState } from '../shared/InvitationErrorState'
import { RootCustomerInviteForm } from './RootCustomerInviteForm'

export interface RootCustomerInviteFlowProps {
  /** The platform ROOT organization id (invitations here are into the root org). */
  rootOrganizationId: string
  /** The caller's role in the root org. Only an `owner` reaches the form. */
  userRole: OrgRole | null
  client?: InvitationsApiClient
  getToken?: HttpClientOptions['getToken']
  onInvited?: (invitation: OrgInvitation) => void
}

/**
 * RootCustomerInviteFlow — the root-org owner's customer-invite entry
 * (design/frames/org-invitations-v2, flow `root-customer-invite`, route
 * `/root/customers`). A non-owner gets the in-place forbidden state (403
 * contract) instead of the form; the server re-checks regardless, the guard just
 * avoids offering an action that can only fail.
 */
export function RootCustomerInviteFlow({
  rootOrganizationId,
  userRole,
  client: injected,
  getToken,
  onInvited,
}: RootCustomerInviteFlowProps) {
  const { messages } = useIdentityI18n()
  const r = messages.invitationsV2.root
  const client = useMemo(() => injected ?? createInvitationsClient({ getToken }), [injected, getToken])

  return (
    <div data-flow="root-customer-invite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--text-primary)' }}>
          {r.title}
        </h1>
        <p style={{ margin: 'var(--space-2) 0 0', maxInlineSize: '45rem', color: 'var(--text-secondary)' }}>{r.subtitle}</p>
      </div>
      {userRole === 'owner' ? (
        <RootCustomerInviteForm
          onSubmit={(body) => client.create(rootOrganizationId, { ...body, memberType: 'customer' })}
          onSent={onInvited}
        />
      ) : (
        <InvitationErrorState failure="forbidden" detail={r.forbiddenBody} />
      )}
    </div>
  )
}
