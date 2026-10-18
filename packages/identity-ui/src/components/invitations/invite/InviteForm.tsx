import { useMemo, useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import {
  classifyInviteError,
  type InvitationChannel,
  type InvitationRole,
  type InviteFailure,
  type InviteeRef,
  type MemberType,
  type OrgInvitation,
  type OrgInvitationCreate,
} from '../../../api/invitationsClient'
import { isValidEmail } from '../../invites/parseEmails'
import { InvitationErrorState } from '../shared/InvitationErrorState'
import { InviteChannelToggle, InviteeKindToggle, MemberTypeToggle, type InviteeKind } from './InviteToggles'
import { EmailInviteField, InviteeAccountPicker, PhoneE164Field, type AccountOption } from './InviteFields'
import { InviteRolePicker } from './InviteRolePicker'
import { InviteReviewSummary } from './InviteReviewSummary'

export interface InviteFormProps {
  /** `POST /organizations/{id}/invitations`. The service mints the id + token. */
  onSubmit: (body: OrgInvitationCreate) => Promise<OrgInvitation>
  /** Called after a successful send. */
  onSent?: (invitation: OrgInvitation) => void
  /** Called when delivery failed but the invitation was saved (the host should refresh its list). */
  onDraftSaved?: () => void
  onCancel?: () => void
  /**
   * Server-side account search for the "existing account-holder" kind. When
   * omitted the "existing" option is disabled (the form never fetches or filters
   * a full directory itself).
   */
  searchAccounts?: (query: string) => Promise<AccountOption[]>
  /** Offer the existing/external toggle (the org modal does; the root customer form does not). */
  showKind?: boolean
  roles?: InvitationRole[]
  defaultRole?: InvitationRole
  defaultMemberType?: MemberType
  /** Fix the member type (inert toggle) — the root customer surface fixes `customer`. */
  lockedMemberType?: MemberType
  /** `data-panel` of the review summary. */
  reviewPanel?: string
  /** Per-role description overrides. */
  roleDescriptions?: Partial<Record<InvitationRole, string>>
  emailLabel?: string
  emailPlaceholder?: string
  emailHint?: string
  /** `data-input` hook of the email field. */
  emailInputHook?: string
  memberTypeHint?: string
  sendLabel?: string
  /** `data-action` of the submit button. */
  sendAction?: string
}

/**
 * The invitation form body, shared by the org `InviteModalV2` and the root
 * customer surface: invitee kind → channel → address → role → member type →
 * live review → send. Builds the contract's discriminated `InviteeRef`; Send is
 * blocked until a valid address (email / E.164 phone / chosen account), a role
 * and a member type are present. Server failures render IN PLACE
 * (`InvitationErrorState`), never as a redirect.
 */
export function InviteForm({
  onSubmit,
  onSent,
  onDraftSaved,
  onCancel,
  searchAccounts,
  showKind = true,
  roles,
  defaultRole = 'member',
  defaultMemberType = 'employee',
  lockedMemberType,
  reviewPanel,
  roleDescriptions,
  emailLabel,
  emailPlaceholder,
  emailHint,
  emailInputHook,
  memberTypeHint,
  sendLabel,
  sendAction = 'send-invite',
}: InviteFormProps) {
  const { messages, t } = useIdentityI18n()
  const m = messages.invitationsV2.invite

  const [kind, setKind] = useState<InviteeKind>('external')
  const [channel, setChannel] = useState<InvitationChannel>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneValid, setPhoneValid] = useState(false)
  const [account, setAccount] = useState<AccountOption | null>(null)
  const [role, setRole] = useState<InvitationRole>(defaultRole)
  const [memberType, setMemberType] = useState<MemberType>(lockedMemberType ?? defaultMemberType)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<InviteFailure | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const effectiveMemberType = lockedMemberType ?? memberType

  const invitee = useMemo<InviteeRef | null>(() => {
    if (kind === 'existing') return account ? { kind: 'account', userId: account.userId } : null
    if (channel === 'email') {
      return isValidEmail(email) ? { kind: 'external', channel: 'email', email: email.trim() } : null
    }
    return phoneValid ? { kind: 'external', channel: 'whatsapp', phone } : null
  }, [kind, channel, email, phone, phoneValid, account])

  const reviewAddress =
    kind === 'existing' ? (account ? (account.name ?? account.email ?? account.userId) : null) : invitee
      ? channel === 'email'
        ? email.trim()
        : phone
      : null
  const reviewChannel: InvitationChannel | 'account' = kind === 'existing' ? 'account' : channel

  async function submit() {
    if (!invitee || submitting) return
    setSubmitting(true)
    setFailure(null)
    setSent(null)
    try {
      const created = await onSubmit({ invitee, role, memberType: effectiveMemberType })
      setSent(t(m.sent, { address: reviewAddress ?? '' }))
      setEmail('')
      setPhone('')
      setPhoneValid(false)
      setAccount(null)
      onSent?.(created)
    } catch (err) {
      const f = classifyInviteError(err, 'admin')
      setFailure(f)
      if (f === 'delivery-failed') onDraftSaved?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      data-form="invite"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
    >
      {showKind && (
        <Field label={m.kindLabel}>
          <InviteeKindToggle value={kind} onChange={setKind} existingDisabled={!searchAccounts} />
          <Hint>{!searchAccounts ? m.kindExistingUnavailable : m.kindHint}</Hint>
        </Field>
      )}

      {kind === 'existing' && searchAccounts ? (
        <InviteeAccountPicker search={searchAccounts} value={account} onChange={setAccount} />
      ) : (
        <>
          <Field label={m.channelLabel}>
            <InviteChannelToggle value={channel} onChange={setChannel} />
          </Field>
          {channel === 'email' ? (
            <EmailInviteField
              value={email}
              onChange={setEmail}
              label={emailLabel}
              placeholder={emailPlaceholder}
              hint={emailHint}
              dataInput={emailInputHook}
            />
          ) : (
            <PhoneE164Field
              value={phone}
              onChange={(e164, valid) => {
                setPhone(e164)
                setPhoneValid(valid)
                if (failure === 'invalid-phone') setFailure(null)
              }}
              error={failure === 'invalid-phone' ? m.phoneInvalid : undefined}
            />
          )}
        </>
      )}

      <InviteRolePicker value={role} onChange={setRole} roles={roles} descriptions={roleDescriptions} />

      <Field label={m.memberTypeLabel} required>
        <MemberTypeToggle value={effectiveMemberType} onChange={setMemberType} locked={Boolean(lockedMemberType)} />
        <Hint>{memberTypeHint ?? m.memberTypeHint}</Hint>
      </Field>

      <InviteReviewSummary
        panel={reviewPanel}
        address={reviewAddress}
        channel={reviewChannel}
        role={role}
        memberType={effectiveMemberType}
      />

      {sent && (
        <div role="status" aria-live="polite" data-state="sent" style={{ fontSize: 'var(--text-sm)', color: 'var(--success-color)' }}>
          {sent}
        </div>
      )}
      {failure && failure !== 'invalid-phone' && (
        <InvitationErrorState failure={failure} onRetry={failure === 'delivery-failed' ? undefined : submit} />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        {onCancel && (
          <Button type="button" variant="ghost" data-action="close-invite" onClick={onCancel}>
            {messages.common.cancel}
          </Button>
        )}
        <Button type="submit" variant="primary" data-action={sendAction} disabled={!invitee || submitting}>
          {submitting ? m.sending : (sendLabel ?? m.send)}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-secondary)' }}>
        {label}
        {required ? <span aria-hidden="true" style={{ color: 'var(--error-color)' }}> *</span> : null}
      </span>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{children}</span>
}
