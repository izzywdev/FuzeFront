import { useState } from 'react'
import { Button, Input, Spinner } from '@fuzefront/design-system'
import { passwordMeetsPolicy } from './policy'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { Actions, CardHeading, Hint, SeamCard } from '../common/flowKit'
import { PasswordFields } from './PasswordFields'

/** Field-level errors a flow can attach to the forms. */
export interface PasswordFormErrors {
  /** Wrong current password (change only). */
  current?: boolean
  /** The new password was rejected by policy (client gate or server 400). */
  policy?: boolean
}

export interface ChangePasswordFormProps {
  submitting?: boolean
  errors?: PasswordFormErrors
  onSubmit: (currentPassword: string, newPassword: string) => void
  onCancel?: () => void
  /** "Forgot your current password?" → the reset flow. */
  onForgot?: () => void
  forgotHref?: string
}

/** Change an existing password: current + new + confirm (frame 05, variant change). */
export function ChangePasswordForm({
  submitting,
  errors,
  onSubmit,
  onCancel,
  onForgot,
  forgotHref = '/reset',
}: ChangePasswordFormProps) {
  const { messages: m } = useAccountSecurityI18n()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [local, setLocal] = useState<{ current?: string; next?: string; confirm?: string; policy?: boolean }>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const out: typeof local = {}
    if (!current) out.current = m.password.errors.required
    if (!next) out.next = m.password.errors.required
    else if (!passwordMeetsPolicy(next)) {
      out.next = m.password.errors.policy
      out.policy = true
    }
    if (next && confirm !== next) out.confirm = m.password.errors.mismatch
    setLocal(out)
    if (Object.keys(out).length) return
    onSubmit(current, next)
  }

  const currentError = local.current ?? (errors?.current ? m.password.errors.wrongCurrent : undefined)
  const newError = local.next ?? (errors?.policy ? m.password.errors.policy : undefined)

  return (
    <form
      onSubmit={submit}
      noValidate
      data-variant="change"
      data-has-password="true"
      aria-labelledby="pw-change-heading"
    >
      <SeamCard>
        <CardHeading id="pw-change-heading">{m.password.change.heading}</CardHeading>
        <Hint>{m.password.change.hint}</Hint>

        <div
          data-error={errors?.current ? 'wrong-current' : undefined}
          data-field-error={currentError ? 'current-password' : undefined}
        >
          <Input
            label={m.password.change.current}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={currentError}
            disabled={submitting}
            data-input="current-password"
          />
        </div>
        <a
          href={forgotHref}
          data-nav="forgot"
          onClick={(e) => {
            if (onForgot) {
              e.preventDefault()
              onForgot()
            }
          }}
          style={{
            display: 'inline-block',
            marginBlockStart: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--accent-color)',
          }}
        >
          {m.password.change.forgot}
        </a>

        <PasswordFields
          newLabel={m.password.change.newPassword}
          confirmLabel={m.password.change.confirm}
          value={next}
          confirm={confirm}
          onValue={setNext}
          onConfirm={setConfirm}
          newHook="new-password"
          confirmHook="confirm-password"
          newError={newError}
          confirmError={local.confirm}
          disabled={submitting}
          policyErrorHook={Boolean(errors?.policy || local.policy)}
        />

        <Actions>
          <Button
            type="submit"
            variant="primary"
            data-action="change-password"
            disabled={submitting}
            aria-busy={submitting || undefined}
            leadingIcon={submitting ? <Spinner size={16} label={m.password.change.submitting} /> : undefined}
          >
            {submitting ? m.password.change.submitting : m.password.change.submit}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" data-action="cancel" onClick={onCancel} disabled={submitting}>
              {m.password.change.cancel}
            </Button>
          )}
        </Actions>
      </SeamCard>
    </form>
  )
}

export interface SetPasswordFormProps {
  submitting?: boolean
  errors?: Pick<PasswordFormErrors, 'policy'>
  onSubmit: (newPassword: string) => void
  onCancel?: () => void
}

/** Set a first password on a social-only account (frame 05, variant set). */
export function SetPasswordForm({ submitting, errors, onSubmit, onCancel }: SetPasswordFormProps) {
  const { messages: m } = useAccountSecurityI18n()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [local, setLocal] = useState<{ next?: string; confirm?: string; policy?: boolean }>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const out: typeof local = {}
    if (!next) out.next = m.password.errors.required
    else if (!passwordMeetsPolicy(next)) {
      out.next = m.password.errors.policy
      out.policy = true
    }
    if (next && confirm !== next) out.confirm = m.password.errors.mismatch
    setLocal(out)
    if (Object.keys(out).length) return
    onSubmit(next)
  }

  const newError = local.next ?? (errors?.policy ? m.password.errors.policy : undefined)

  return (
    <form
      onSubmit={submit}
      noValidate
      data-variant="set"
      data-has-password="false"
      aria-labelledby="pw-set-heading"
    >
      <SeamCard>
        <CardHeading id="pw-set-heading">{m.password.set.heading}</CardHeading>
        <Hint>{m.password.set.hint}</Hint>
        <PasswordFields
          newLabel={m.password.set.newPassword}
          confirmLabel={m.password.set.confirm}
          value={next}
          confirm={confirm}
          onValue={setNext}
          onConfirm={setConfirm}
          newHook="set-password"
          confirmHook="set-confirm"
          newError={newError}
          confirmError={local.confirm}
          disabled={submitting}
          policyErrorHook={Boolean(errors?.policy || local.policy)}
        />
        <Actions>
          <Button
            type="submit"
            variant="primary"
            data-action="set-password"
            disabled={submitting}
            aria-busy={submitting || undefined}
            leadingIcon={submitting ? <Spinner size={16} label={m.password.set.submitting} /> : undefined}
          >
            {submitting ? m.password.set.submitting : m.password.set.submit}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" data-action="cancel" onClick={onCancel} disabled={submitting}>
              {m.password.set.cancel}
            </Button>
          )}
        </Actions>
      </SeamCard>
    </form>
  )
}
