import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { OrgInvitation, OrgInvitationCreate } from '../../../api/invitationsClient'
import { InviteForm } from '../invite/InviteForm'

export interface RootCustomerInviteFormProps {
  /** `POST /organizations/{rootOrgId}/invitations` with `memberType: 'customer'` forced. */
  onSubmit: (body: OrgInvitationCreate) => Promise<OrgInvitation>
  onSent?: (invitation: OrgInvitation) => void
}

/**
 * The root owner's customer-invite form (design/frames/org-invitations-v2/
 * 05-root-customer-invite.html): channel (email | WhatsApp), a personal-email /
 * E.164 field, role radios (member | viewer, default Viewer), member type FIXED
 * to Customer (inert toggle, `aria-disabled`), a live review and Send. The
 * invitee needs no existing account — they go through accept → sign up → bind.
 * `[data-panel="root-customer-invite"]`, review `[data-panel="customer-preview"]`.
 */
export function RootCustomerInviteForm({ onSubmit, onSent }: RootCustomerInviteFormProps) {
  const { messages } = useIdentityI18n()
  const r = messages.invitationsV2.root
  return (
    <section
      data-panel="root-customer-invite"
      aria-label={r.panelTitle}
      style={{
        maxInlineSize: '35rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div style={{ blockSize: 'var(--border-width-strong)', background: 'var(--seam)' }} aria-hidden="true" />
      <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
          {r.panelTitle}
        </h2>
        <InviteForm
          onSubmit={onSubmit}
          onSent={onSent}
          showKind={false}
          roles={['member', 'viewer']}
          defaultRole="viewer"
          lockedMemberType="customer"
          reviewPanel="customer-preview"
          roleDescriptions={{ member: r.roleMemberDesc, viewer: r.roleViewerDesc }}
          emailLabel={r.emailLabel}
          emailPlaceholder={r.emailPlaceholder}
          emailHint={r.emailHint}
          emailInputHook="customer-email"
          memberTypeHint={r.memberTypeHint}
          sendLabel={r.send}
          sendAction="send-customer-invite"
        />
      </div>
    </section>
  )
}
