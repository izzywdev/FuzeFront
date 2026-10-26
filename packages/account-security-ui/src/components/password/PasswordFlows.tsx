import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spinner, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { isConflict, isPolicyRejection, statusOf } from '../../api/errors'
import { HttpError } from '../../api/http'
import type { IdentityConnections, PasswordClient, FullAccountSecurityClient } from '../../types'
import {
  Actions,
  ErrorWithRetry,
  FlowPage,
  FlowRoot,
  SeamCard,
  useInFlight,
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
  /**
   * Whether the host serves the `/reset` route. The "forgot password" / "reset"
   * exits render ONLY when true (default false): the host mounts `/reset` behind
   * its auth-experience flag, so an unconditional link would 404.
   */
  canReset?: boolean
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
  | { name: 'indeterminate' }
  | { name: 'exists' }
  | { name: 'no-password' }
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
function AlreadyHasPassword({ onChange, onReset }: { onChange: () => void; onReset?: () => void }) {
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
            {onReset && (
              <Button variant="ghost" data-action="go-reset" onClick={onReset}>
                {m.password.exists.goReset}
              </Button>
            )}
          </Actions>
        }
      >
        {m.password.exists.text}
      </StatusCallout>
    </div>
  )
}

/** Shown when change-password hits 409 NO_PASSWORD: the account has no password yet — set one instead. */
function NoPasswordYet({ onSet }: { onSet: () => void }) {
  const { messages: m } = useAccountSecurityI18n()
  return (
    <div data-state="no-password">
      <StatusCallout
        tone="warning"
        icon="🔑"
        title={m.password.noPassword.title}
        actions={
          <Button variant="primary" data-action="go-set" onClick={onSet}>
            {m.password.noPassword.action}
          </Button>
        }
      >
        {m.password.noPassword.text}
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
  canReset,
}: FlowBaseProps & PasswordFlowCallbacks) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<PasswordClient>(client, getToken)
  const [phase, setPhase] = useState<Phase>({ name: 'form' })
  const [errors, setErrors] = useState<PasswordFormErrors>({})
  const inFlight = useInFlight()
  const nav = (r: string) => (onNavigate ? onNavigate(r) : undefined)

  const submit = useCallback(
    (current: string, next: string) => inFlight(async () => {
      setErrors({})
      setPhase({ name: 'submitting' })
      try {
        await api.changePassword(current, next)
        setPhase({ name: 'success' })
        onDone?.()
      } catch (err) {
        // POST /v1/security/password/change: 400 INVALID_CREDENTIALS (wrong current) /
        // 422 PASSWORD_POLICY / 409 NO_PASSWORD / 204.
        const code = err instanceof HttpError ? err.code : undefined
        const status = statusOf(err)
        if (code === 'INVALID_CREDENTIALS') {
          setErrors({ current: true })
          setPhase({ name: 'form' })
        } else if (status === 409) {
          setPhase({ name: 'no-password' })
        } else if (isPolicyRejection(err)) {
          setErrors({ policy: true })
          setPhase({ name: 'form' })
        } else if (status === undefined || status >= 500) {
          // Transport failure / 5xx: the server may have committed the change before the
          // response was lost. Do NOT claim "unchanged" and do NOT offer a blind replay.
          setPhase({ name: 'indeterminate' })
        } else {
          setPhase({ name: 'error', retry: () => void submit(current, next) })
        }
      }
    }),
    [api, onDone, inFlight]
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
      ) : phase.name === 'no-password' ? (
        <NoPasswordYet onSet={() => nav(ROUTES.password + '?mode=set')} />
      ) : phase.name === 'indeterminate' ? (
        <div data-state="indeterminate">
          <SeamCard data-error="change-indeterminate">
            <StatusCallout tone="warning" icon="?" title={m.password.errors.indeterminateTitle} role="alert">
              {m.password.errors.indeterminateText}
            </StatusCallout>
            <Actions>
              <Button variant="primary" data-action="back-to-security" onClick={() => (onCancel ? onCancel() : nav(ROUTES.security))}>
                {m.password.success.back}
              </Button>
            </Actions>
          </SeamCard>
        </div>
      ) : phase.name === 'error' ? (
        <ErrorWithRetry
          data-state="error"
          title={m.password.errors.genericTitle}
          text={m.password.errors.definiteText}
          retryLabel={m.password.errors.retry}
          onRetry={phase.retry}
        />
      ) : (
        <ChangePasswordForm
          submitting={phase.name === 'submitting'}
          errors={errors}
          onSubmit={(c, n) => void submit(c, n)}
          onCancel={() => (onCancel ? onCancel() : nav(ROUTES.security))}
          onForgot={onNavigate && canReset ? () => nav(ROUTES.reset) : undefined}
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
  canReset,
}: FlowBaseProps & PasswordFlowCallbacks) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<PasswordClient>(client, getToken)
  const [phase, setPhase] = useState<Phase>({ name: 'form' })
  const [errors, setErrors] = useState<Pick<PasswordFormErrors, 'policy'>>({})
  const inFlight = useInFlight()
  const nav = (r: string) => (onNavigate ? onNavigate(r) : undefined)

  const submit = useCallback(
    (next: string) => inFlight(async () => {
      setErrors({})
      setPhase({ name: 'submitting' })
      try {
        await api.setPassword(next)
        setPhase({ name: 'success' })
        onDone?.()
      } catch (err) {
        if (isConflict(err)) {
          setPhase({ name: 'exists' })
        } else if (isPolicyRejection(err)) {
          // 400 / 422 PASSWORD_POLICY: back to the editable form with the policy error.
          setErrors({ policy: true })
          setPhase({ name: 'form' })
        } else {
          setPhase({ name: 'error', retry: () => void submit(next) })
        }
      }
    }),
    [api, onDone, inFlight]
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
          onReset={onNavigate && canReset ? () => nav(ROUTES.reset) : undefined}
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
  const [forced, setForced] = useState<'change' | 'set' | null>(null)
  const alive = useRef(true)
  const navigate = (route: string) =>
    route.includes('mode=change')
      ? setForced('change')
      : route.includes('mode=set')
        ? setForced('set')
        : props.onNavigate?.(route)

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
  const showChange = forced ? forced === 'change' : state.connections.hasPassword
  return showChange ? (
    <ChangePasswordFlow {...props} onNavigate={navigate} />
  ) : (
    <SetPasswordFlow {...props} onNavigate={navigate} />
  )
}
