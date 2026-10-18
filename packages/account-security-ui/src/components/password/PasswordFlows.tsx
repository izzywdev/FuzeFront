import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spinner, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { isConflict, statusOf } from '../../api/errors'
import { HttpError } from '../../api/http'
import type { IdentityConnections, PasswordClient, FullAccountSecurityClient } from '../../types'
import {
  Actions,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { ChangePasswordForm, SetPasswordForm, type PasswordFormErrors } from './PasswordForms'

export interface PasswordFlowCallbacks {
  /** Navigate within the host (react-router `navigate`). */
  onNavigate?: (route: string) => void
  /** Called after a successful change / set. */
  onDone?: () => void
  onCancel?: () => void
}

const ROUTES = {
  security: '/account/security',
  password: '/account/security/password',
  reset: '/reset',
}

type Phase =
  | { name: 'form' }
  | { name: 'submitting' }
  | { name: 'error'; retry: () => void }
  | { name: 'exists' }
  | { name: 'success' }

function SuccessPanel({
  title,
  text,
  onBack,
}: {
  title: string
  text: string
  onBack: () => void
}) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-state="success">
      <StatusCallout
        tone="success"
        icon="✓"
        title={title}
        actions={
          <Button variant="ghost" data-action="back" onClick={onBack}>
            {m.password.success.back}
          </Button>
        }
      >
        {text}
      </StatusCallout>
    </div>
  )
}

/** Shown when set-password hits 409: a password already exists (frame 06, already-has-password). */
function AlreadyHasPassword({ onChange, onReset }: { onChange: () => void; onReset: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-state="already-has-password" data-error="password-exists">
      <StatusCallout
        tone="warning"
        icon="🔑"
        title={m.password.exists.title}
        actions={
          <Actions style={{ marginBlockStart: 0 }}>
            <Button variant="primary" data-action="go-change" onClick={onChange}>
              {m.password.exists.goChange}
            </Button>
            <Button variant="ghost" data-action="go-reset" onClick={onReset}>
              {m.password.exists.goReset}
            </Button>
          </Actions>
        }
      >
        {m.password.exists.text}
      </StatusCallout>
    </div>
  )
}

/**
 * Signed-in CHANGE password (frames 05 variant change + 06). Wrong current
 * password → inline field error; policy rejection → inline policy error;
 * anything else → a retryable error that leaves the password unchanged.
 */
export function ChangePasswordFlow(props: FlowBaseProps & PasswordFlowCallbacks) {
  return (
    <FlowRoot locale={props.locale}>
      <ChangePasswordInner {...props} />
    </FlowRoot>
  )
}

function ChangePasswordInner({
  client,
  getToken,
  onNavigate,
  onDone,
  onCancel,
}: FlowBaseProps & PasswordFlowCallbacks) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<PasswordClient>(client, getToken)
  const [phase, setPhase] = useState<Phase>({ name: 'form' })
  const [errors, setErrors] = useState<PasswordFormErrors>({})
  const nav = (r: string) => (onNavigate ? onNavigate(r) : undefined)

  const submit = useCallback(
    async (current: string, next: string) => {
      setErrors({})
      setPhase({ name: 'submitting' })
      try {
        await api.changePassword(current, next)
        setPhase({ name: 'success' })
        onDone?.()
      } catch (err) {
        const code = err instanceof HttpError ? err.code : undefined
        if (code === 'INVALID_CREDENTIALS') {
          setErrors({ current: true })
          setPhase({ name: 'form' })
        } else if (statusOf(err) === 400) {
          setErrors({ policy: true })
          setPhase({ name: 'form' })
        } else {
          setPhase({ name: 'error', retry: () => void submit(current, next) })
        }
      }
    },
    [api, onDone]
  )

  return (
    <FlowPage
      title={m.password.page.title}
      subtitle={m.password.page.subtitle}
      data-frame="05-signed-in"
      data-flow="change-password"
    >
      {phase.name === 'success' ? (
        <SuccessPanel
          title={m.password.success.changedTitle}
          text={m.password.success.changedText}
          onBack={() => (onCancel ? onCancel() : nav(ROUTES.security))}
        />
      ) : phase.name === 'error' ? (
        <ErrorWithRetry
          data-state="error"
          title={m.password.errors.genericTitle}
          text={m.password.errors.genericText}
          retryLabel={m.password.errors.retry}
          onRetry={phase.retry}
        />
      ) : (
        <ChangePasswordForm
          submitting={phase.name === 'submitting'}
          errors={errors}
          onSubmit={(c, n) => void submit(c, n)}
          onCancel={() => (onCancel ? onCancel() : nav(ROUTES.security))}
          onForgot={onNavigate ? () => nav(ROUTES.reset) : undefined}
        />
      )}
    </FlowPage>
  )
}

/**
 * Signed-in SET first password on a social-only account (frames 05 variant set +
 * 06). 409 (one exists) routes to change / reset instead of crashing.
 */
export function SetPasswordFlow(props: FlowBaseProps & PasswordFlowCallbacks) {
  return (
    <FlowRoot locale={props.locale}>
      <SetPasswordInner {...props} />
    </FlowRoot>
  )
}

function SetPasswordInner({
  client,
  getToken,
  onNavigate,
  onDone,
  onCancel,
}: FlowBaseProps & PasswordFlowCallbacks) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<PasswordClient>(client, getToken)
  const [phase, setPhase] = useState<Phase>({ name: 'form' })
  const [errors, setErrors] = useState<Pick<PasswordFormErrors, 'policy'>>({})
  const nav = (r: string) => (onNavigate ? onNavigate(r) : undefined)

  const submit = useCallback(
    async (next: string) => {
      setErrors({})
      setPhase({ name: 'submitting' })
      try {
        await api.setPassword(next)
        setPhase({ name: 'success' })
        onDone?.()
      } catch (err) {
        if (isConflict(err)) {
          setPhase({ name: 'exists' })
        } else if (statusOf(err) === 400) {
          setErrors({ policy: true })
          setPhase({ name: 'form' })
        } else {
          setPhase({ name: 'error', retry: () => void submit(next) })
        }
      }
    },
    [api, onDone]
  )

  return (
    <FlowPage
      title={m.password.page.title}
      subtitle={m.password.page.subtitle}
      data-frame="05-signed-in"
      data-flow="set-password"
    >
      {phase.name === 'success' ? (
        <SuccessPanel
          title={m.password.success.setTitle}
          text={m.password.success.setText}
          onBack={() => (onCancel ? onCancel() : nav(ROUTES.security))}
        />
      ) : phase.name === 'exists' ? (
        <AlreadyHasPassword
          onChange={() => nav(ROUTES.password + '?mode=change')}
          onReset={() => nav(ROUTES.reset)}
        />
      ) : phase.name === 'error' ? (
        <ErrorWithRetry
          data-state="error"
          title={m.password.errors.genericTitle}
          text={m.password.errors.genericText}
          retryLabel={m.password.errors.retry}
          onRetry={phase.retry}
        />
      ) : (
        <SetPasswordForm
          submitting={phase.name === 'submitting'}
          errors={errors}
          onSubmit={(n) => void submit(n)}
          onCancel={() => (onCancel ? onCancel() : nav(ROUTES.security))}
        />
      )}
    </FlowPage>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; connections: IdentityConnections }

/**
 * The single `/account/security/password` surface: reads the account's
 * `hasPassword` and mounts ChangePasswordFlow (true) or SetPasswordFlow (false).
 * FAIL-CLOSED: `hasPassword` null / undefined / a failed read offers neither
 * variant — it shows a retryable error instead of guessing (the
 * "set a password first" guard of the account-security frames).
 */
export function PasswordManagementFlow(props: FlowBaseProps & PasswordFlowCallbacks) {
  return (
    <FlowRoot locale={props.locale}>
      <PasswordManagementInner {...props} />
    </FlowRoot>
  )
}

function PasswordManagementInner(props: FlowBaseProps & PasswordFlowCallbacks) {
  const { messages: m } = useAccountSecurityI18n()
  const { client, getToken } = props
  const api = useSecurityClient<Pick<FullAccountSecurityClient, 'getConnections'>>(client, getToken)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // A 409 from set-password proves a password exists even though the read said
  // otherwise: "Change password" then switches this surface to the change form.
  const [forcedChange, setForcedChange] = useState(false)
  const alive = useRef(true)
  const navigate = (route: string) =>
    route.includes('mode=change') ? setForcedChange(true) : props.onNavigate?.(route)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const connections = await api.getConnections()
      if (!alive.current) return
      // hasPassword must be an explicit boolean; null/undefined fails closed.
      if (typeof connections?.hasPassword !== 'boolean') {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'ready', connections })
    } catch {
      if (alive.current) setState({ status: 'error' })
    }
  }, [api])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])

  if (state.status === 'loading') {
    return (
      <FlowPage title={m.password.page.title} subtitle={m.password.page.subtitle} data-frame="05-signed-in">
        <div data-state="loading" role="status" aria-busy="true" aria-label={m.password.loading}>
          <Spinner label={m.password.loading} />
        </div>
      </FlowPage>
    )
  }
  if (state.status === 'error') {
    return (
      <FlowPage title={m.password.page.title} subtitle={m.password.page.subtitle} data-frame="05-signed-in">
        <ErrorWithRetry
          data-state="error"
          title={m.password.unknown.title}
          text={m.password.unknown.text}
          retryLabel={m.password.unknown.retry}
          onRetry={() => void load()}
        />
      </FlowPage>
    )
  }
  return state.connections.hasPassword || forcedChange ? (
    <ChangePasswordFlow {...props} onNavigate={navigate} />
  ) : (
    <SetPasswordFlow {...props} onNavigate={navigate} />
  )
}
