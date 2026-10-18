import { useCallback, useState } from 'react'
import { Button, Input, Spinner, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { statusOf } from '../../api/errors'
import type { PasswordClient } from '../../types'
import {
  Actions,
  CardHeading,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  Hint,
  SeamCard,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { PasswordFields } from './PasswordFields'
import { passwordMeetsPolicy } from './policy'

export interface PasswordResetFlowProps extends FlowBaseProps {
  /** Single-use token from the emailed link; present ⇒ start at "choose a new password". */
  token?: string | null
  /** Navigate to the sign-in surface (host). */
  onSignIn?: () => void
  /** Host navigation (used by "request a new link" / "back to sign in" fallbacks). */
  onNavigate?: (route: string) => void
}

type Step =
  | { name: 'request' }
  | { name: 'sent'; email: string }
  | { name: 'confirm' }
  | { name: 'invalid' }
  | { name: 'done' }

export function ResetRequestForm({
  onSubmit,
  onBack,
  submitting,
  initialEmail = '',
}: {
  onSubmit: (email: string) => void
  onBack?: () => void
  submitting?: boolean
  initialEmail?: string
}) {
  const { messages: m } = useAccountSecurityI18n()
  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState<string | undefined>()
  return (
    <form
      data-panel="reset-request"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!/^\S+@\S+$/.test(email.trim())) {
          setError(m.reset.request.invalidEmail)
          return
        }
        setError(undefined)
        onSubmit(email.trim())
      }}
    >
      <SeamCard>
        <CardHeading>{m.reset.request.title}</CardHeading>
        <Hint>{m.reset.request.subtitle}</Hint>
        <Input
          label={m.reset.request.email}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
          disabled={submitting}
          data-input="email"
        />
        <Actions>
          <Button
            type="submit"
            variant="primary"
            fullWidth
            data-action="send-reset"
            disabled={submitting}
            aria-busy={submitting || undefined}
            leadingIcon={submitting ? <Spinner size={16} label={m.reset.request.sending} /> : undefined}
          >
            {submitting ? m.reset.request.sending : m.reset.request.submit}
          </Button>
        </Actions>
        <Hint style={{ marginBlockStart: 'var(--space-4)', marginBlockEnd: 0 }}>{m.reset.request.footnote}</Hint>
        {onBack && (
          <Button variant="ghost" data-action="back-to-sign-in" onClick={onBack}>
            {m.reset.request.back}
          </Button>
        )}
      </SeamCard>
    </form>
  )
}

export function ResetSentNotice({
  onResend,
  onBack,
  resent,
  resending,
}: {
  onResend: () => void
  onBack?: () => void
  resent?: boolean
  resending?: boolean
}) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-panel="reset-sent" data-http="202">
      <SeamCard>
        <CardHeading>{m.reset.sent.title}</CardHeading>
        <Hint>{m.reset.sent.text}</Hint>
        <p
          data-security-note="no-enumeration"
          style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}
        >
          {m.reset.sent.noEnumeration}
        </p>
        {resent && (
          <p role="status" style={{ color: 'var(--success-color)', fontSize: 'var(--text-sm)' }}>
            {m.reset.sent.resent}
          </p>
        )}
        <Actions>
          <Button variant="ghost" data-action="resend" onClick={onResend} disabled={resending}>
            {m.reset.sent.resend}
          </Button>
          {onBack && (
            <Button variant="ghost" data-action="back-to-sign-in" onClick={onBack}>
              {m.reset.sent.back}
            </Button>
          )}
        </Actions>
      </SeamCard>
    </div>
  )
}

export function NewPasswordForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (newPassword: string) => void
  submitting?: boolean
}) {
  const { messages: m } = useAccountSecurityI18n()
  const [value, setValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ next?: string; confirm?: string; policy?: boolean }>({})
  return (
    <form
      data-panel="reset-confirm"
      data-token-state="valid"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const out: typeof errors = {}
        if (!passwordMeetsPolicy(value)) {
          out.next = m.password.errors.policy
          out.policy = true
        }
        if (confirm !== value) out.confirm = m.password.errors.mismatch
        setErrors(out)
        if (Object.keys(out).length) return
        onSubmit(value)
      }}
    >
      <SeamCard>
        <CardHeading>{m.reset.confirm.title}</CardHeading>
        <Hint>{m.reset.confirm.subtitle}</Hint>
        <PasswordFields
          newLabel={m.reset.confirm.newPassword}
          confirmLabel={m.reset.confirm.confirm}
          value={value}
          confirm={confirm}
          onValue={setValue}
          onConfirm={setConfirm}
          newHook="new-password"
          confirmHook="confirm-password"
          newError={errors.next}
          confirmError={errors.confirm}
          disabled={submitting}
          policyErrorHook={Boolean(errors.policy)}
        />
        <Actions>
          <Button
            type="submit"
            variant="primary"
            fullWidth
            data-action="set-new-password"
            disabled={submitting}
            aria-busy={submitting || undefined}
            leadingIcon={submitting ? <Spinner size={16} label={m.reset.confirm.submitting} /> : undefined}
          >
            {submitting ? m.reset.confirm.submitting : m.reset.confirm.submit}
          </Button>
        </Actions>
      </SeamCard>
    </form>
  )
}

export function TokenInvalidNotice({ onRequestAgain }: { onRequestAgain: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-state="token-invalid" data-token-state="invalid">
      <SeamCard tone="danger">
        <StatusCallout
          tone="error"
          icon="!"
          title={m.reset.invalid.title}
          actions={
            <Button variant="primary" data-action="request-again" onClick={onRequestAgain}>
              {m.reset.invalid.requestAgain}
            </Button>
          }
        >
          {m.reset.invalid.text}
        </StatusCallout>
      </SeamCard>
    </div>
  )
}

export function ResetDoneNotice({ onSignIn }: { onSignIn?: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-panel="reset-done">
      <SeamCard>
        <CardHeading>{m.reset.done.title}</CardHeading>
        <Hint>{m.reset.done.text}</Hint>
        <p
          data-security-note="sessions-revoked"
          style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}
        >
          {m.reset.done.sessionsRevoked}
        </p>
        <Actions>
          <Button variant="primary" data-action="go-sign-in" onClick={onSignIn}>
            {m.reset.done.signIn}
          </Button>
        </Actions>
      </SeamCard>
    </div>
  )
}

/**
 * Unauthenticated password reset (frames 01-04 + 06). Request → unconditional
 * "check your email" (the 202 is rendered identically whether or not an account
 * exists — a failed request is NEVER surfaced, so it can't be an enumeration
 * oracle) → choose a new password from the emailed token → done.
 *
 * Note: the host's `/reset` route is also being built in `@fuzefront/auth-ui`
 * (auth-experience frames); this flow is the account-security-ui build of the
 * password-reset frames and is flag-gated (`fuzefront.account-security.password-reset`).
 */
export function PasswordResetFlow(props: PasswordResetFlowProps) {
  return (
    <FlowRoot locale={props.locale}>
      <PasswordResetInner {...props} />
    </FlowRoot>
  )
}

function PasswordResetInner({ client, getToken, token, onSignIn, onNavigate }: PasswordResetFlowProps) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<PasswordClient>(client, getToken)
  const [step, setStep] = useState<Step>(token ? { name: 'confirm' } : { name: 'request' })
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)
  const [failure, setFailure] = useState<(() => void) | null>(null)

  const back = onSignIn ?? (onNavigate ? () => onNavigate('/login') : undefined)

  const request = useCallback(
    async (email: string, isResend = false) => {
      setBusy(true)
      try {
        await api.requestPasswordReset(email)
      } catch {
        // Deliberately swallowed: the confirmation is identical whether or not
        // the request "worked" — surfacing a failure would reveal account state.
      }
      setBusy(false)
      setResent(isResend)
      setStep({ name: 'sent', email })
    },
    [api]
  )

  const confirm = useCallback(
    async (newPassword: string) => {
      setBusy(true)
      setFailure(null)
      try {
        await api.confirmPasswordReset(token ?? '', newPassword)
        setStep({ name: 'done' })
      } catch (err) {
        const s = statusOf(err)
        if (s === 400 || s === 401 || s === 404 || s === 410) setStep({ name: 'invalid' })
        else setFailure(() => () => void confirm(newPassword))
      } finally {
        setBusy(false)
      }
    },
    [api, token]
  )

  return (
    <FlowPage title={m.reset.request.title} data-frame="reset" maxWidth="var(--container-2xl)">
      {failure ? (
        <ErrorWithRetry
          data-state="error"
          title={m.password.errors.genericTitle}
          text={m.password.errors.genericText}
          retryLabel={m.password.errors.retry}
          onRetry={failure}
        />
      ) : step.name === 'request' ? (
        <ResetRequestForm submitting={busy} onSubmit={(e) => void request(e)} onBack={back} />
      ) : step.name === 'sent' ? (
        <ResetSentNotice
          resent={resent}
          resending={busy}
          onResend={() => void request(step.email, true)}
          onBack={back}
        />
      ) : step.name === 'confirm' ? (
        <NewPasswordForm submitting={busy} onSubmit={(p) => void confirm(p)} />
      ) : step.name === 'invalid' ? (
        <TokenInvalidNotice
          onRequestAgain={() => {
            setStep({ name: 'request' })
            onNavigate?.('/reset')
          }}
        />
      ) : (
        <ResetDoneNotice onSignIn={back} />
      )}
    </FlowPage>
  )
}
