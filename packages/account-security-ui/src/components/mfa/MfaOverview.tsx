import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Skeleton } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import type { AuthMethods, MfaClient, MfaFactor } from '../../types'
import {
  Actions,
  CardHeading,
  FlowPage,
  FlowRoot,
  Hint,
  SeamCard,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { FACTOR_ICON, activeFactors, factorName } from './factorMeta'
import { RemoveFactorDialog } from './RemoveFactorDialog'

export interface MfaRoutes {
  overview: string
  addAuthenticator: string
  addPhone: string
  recoveryCodes: string
}

export const DEFAULT_MFA_ROUTES: MfaRoutes = {
  overview: '/account/security/mfa',
  addAuthenticator: '/account/security/mfa/add/authenticator',
  addPhone: '/account/security/mfa/add/phone',
  recoveryCodes: '/account/security/mfa/recovery-codes',
}

export interface MfaNavProps {
  onNavigate?: (route: string) => void
  routes?: Partial<MfaRoutes>
}

export function useMfaNav({ onNavigate, routes }: MfaNavProps) {
  const r = { ...DEFAULT_MFA_ROUTES, ...routes }
  return {
    routes: r,
    go: (route: string) => {
      if (onNavigate) onNavigate(route)
    },
  }
}

// ── Presentational pieces ───────────────────────────────────────────────────

export function MfaFactorRow({
  factor,
  onRemove,
}: {
  factor: MfaFactor
  onRemove: (factor: MfaFactor) => void
}) {
  const { messages: m, t } = useAccountSecurityI18n()
  const name = factorName(m, factor.type)
  const sub =
    factor.type === 'totp'
      ? [
          factor.createdAt
            ? t(m.mfa.overview.addedOn, { date: new Date(factor.createdAt).toLocaleDateString() })
            : null,
          m.mfa.overview.sixDigit,
        ]
          .filter(Boolean)
          .join(' · ')
      : (factor.label ?? '')
  return (
    <div
      data-factor={factor.type}
      data-status={factor.status}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) 0',
        borderBlockEnd: '1px solid var(--border-color)',
      }}
    >
      <span aria-hidden="true">{FACTOR_ICON[factor.type]}</span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontWeight: 'var(--weight-medium)' }}>{name}</span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{sub}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        data-action="remove-factor"
        data-factor-id={factor.factorId}
        aria-label={t(m.mfa.overview.removeAria, { name })}
        onClick={() => onRemove(factor)}
      >
        {m.mfa.overview.remove}
      </Button>
    </div>
  )
}

export function MfaFactorList({
  factors,
  onRemove,
}: {
  factors: MfaFactor[]
  onRemove: (factor: MfaFactor) => void
}) {
  return (
    <div role="list">
      {factors.map((f) => (
        <div role="listitem" key={f.factorId}>
          <MfaFactorRow factor={f} onRemove={onRemove} />
        </div>
      ))}
    </div>
  )
}

/**
 * "Add another method". HONEST DEGRADE: SMS is offered only when the server's
 * `methods.mfa.types` includes `sms` — never a row that cannot deliver.
 */
export function AddFactorMenu({
  methods,
  onAdd,
}: {
  methods: AuthMethods
  onAdd: (kind: 'totp' | 'sms') => void
}) {
  const { messages: m } = useAccountSecurityI18n()
  const rows: Array<{ kind: 'totp' | 'sms'; desc: string }> = []
  if (methods.mfa.types.includes('totp')) rows.push({ kind: 'totp', desc: m.mfa.overview.addTotpDesc })
  if (methods.mfa.types.includes('sms')) rows.push({ kind: 'sms', desc: m.mfa.overview.addSmsDesc })
  if (rows.length === 0) return null
  return (
    <div data-component="add-factor-menu" style={{ marginBlockStart: 'var(--space-5)' }}>
      <Hint>{m.mfa.overview.addHeading}</Hint>
      {rows.map((r) => (
        <div
          key={r.kind}
          data-add={r.kind}
          data-available="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            marginBlockEnd: 'var(--space-2)',
          }}
        >
          <span aria-hidden="true">{FACTOR_ICON[r.kind]}</span>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 'var(--weight-medium)' }}>{factorName(m, r.kind)}</span>
            <small style={{ color: 'var(--text-tertiary)' }}>{r.desc}</small>
          </span>
          <Button variant="ghost" size="sm" data-action={`add-${r.kind}`} onClick={() => onAdd(r.kind)}>
            {m.mfa.overview.setUp}
          </Button>
        </div>
      ))}
    </div>
  )
}

export type MfaOverviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; methods: AuthMethods; factors: MfaFactor[] }

export function MfaOverviewPanel({
  state,
  onRetry,
  onRemove,
  onAdd,
  onEnrollFirst,
}: {
  state: MfaOverviewState
  onRetry: () => void
  onRemove: (factor: MfaFactor) => void
  onAdd: (kind: 'totp' | 'sms') => void
  onEnrollFirst: () => void
}) {
  const { messages: m, t } = useAccountSecurityI18n()

  if (state.status === 'loading') {
    return (
      <SeamCard data-panel="mfa-overview" data-state="loading" aria-busy="true" role="status" aria-label={m.mfa.overview.loadingLabel}>
        {[0, 1].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', marginBlockEnd: 'var(--space-4)' }}>
            <Skeleton width="var(--space-8)" height="var(--space-8)" radius="var(--radius-md)" />
            <Skeleton width="55%" height="var(--space-4)" />
          </div>
        ))}
      </SeamCard>
    )
  }
  if (state.status === 'error') {
    return (
      <SeamCard data-panel="mfa-overview" data-state="error" tone="danger">
        <CardHeading>{m.mfa.overview.errorTitle}</CardHeading>
        <Hint>{m.mfa.overview.errorText}</Hint>
        <Button variant="ghost" data-action="retry" onClick={onRetry}>
          {m.mfa.overview.retry}
        </Button>
      </SeamCard>
    )
  }
  const active = activeFactors(state.factors)
  if (active.length === 0) {
    return (
      <SeamCard data-panel="mfa-overview" data-state="empty">
        <CardHeading>{m.mfa.overview.emptyTitle}</CardHeading>
        <Hint>{m.mfa.overview.emptyText}</Hint>
        <Actions>
          <Button variant="primary" data-action="enroll-first" onClick={onEnrollFirst}>
            {m.mfa.overview.enrollFirst}
          </Button>
        </Actions>
      </SeamCard>
    )
  }
  return (
    <SeamCard data-panel="mfa-overview" data-state="loaded">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <CardHeading>{m.mfa.overview.heading}</CardHeading>
        <Badge tone="success" dot>
          {t(m.mfa.overview.activeCount, { count: active.length })}
        </Badge>
      </div>
      <MfaFactorList factors={active} onRemove={onRemove} />
      <AddFactorMenu methods={state.methods} onAdd={onAdd} />
    </SeamCard>
  )
}

/**
 * Two-factor overview (frames 01 + 06): enrolled methods, honest-degrade add
 * menu, recovery-codes entry, and the remove flow with the 409 guard. Renders
 * every state: loading skeleton, empty, loaded, load-error + retry.
 */
export function MfaOverviewFlow(props: FlowBaseProps & MfaNavProps) {
  return (
    <FlowRoot locale={props.locale}>
      <MfaOverviewInner {...props} />
    </FlowRoot>
  )
}

function MfaOverviewInner(props: FlowBaseProps & MfaNavProps) {
  const { messages: m } = useAccountSecurityI18n()
  const api = useSecurityClient<MfaClient>(props.client, props.getToken)
  const { routes, go } = useMfaNav(props)
  const [state, setState] = useState<MfaOverviewState>({ status: 'loading' })
  const [removing, setRemoving] = useState<MfaFactor | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [methods, factors] = await Promise.all([api.getMethods(), api.listFactors()])
      if (alive.current) setState({ status: 'ready', methods, factors })
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

  const reloadQuietly = useCallback(async () => {
    try {
      const [methods, factors] = await Promise.all([api.getMethods(), api.listFactors()])
      if (alive.current) setState({ status: 'ready', methods, factors })
    } catch {
      /* keep the last confirmed state; the removed dialog already reported success */
    }
  }, [api])

  const others =
    state.status === 'ready' && removing
      ? activeFactors(state.factors).filter((f) => f.factorId !== removing.factorId).length
      : 0

  return (
    <FlowPage title={m.mfa.page.title} subtitle={m.mfa.page.subtitle} data-frame="01-mfa-overview">
      <MfaOverviewPanel
        state={state}
        onRetry={() => void load()}
        onRemove={setRemoving}
        onAdd={(k) => go(k === 'totp' ? routes.addAuthenticator : routes.addPhone)}
        onEnrollFirst={() => go(routes.addAuthenticator)}
      />
      {state.status === 'ready' && activeFactors(state.factors).length > 0 && (
        <SeamCard data-panel="recovery-status">
          <CardHeading>{m.mfa.overview.recoveryHeading}</CardHeading>
          <Hint>
            {m.mfa.overview.recoveryText}{' '}
            <a
              href={routes.recoveryCodes}
              data-action="view-recovery"
              onClick={(e) => {
                if (props.onNavigate) {
                  e.preventDefault()
                  go(routes.recoveryCodes)
                }
              }}
              style={{ color: 'var(--accent-color)' }}
            >
              {m.mfa.overview.recoveryLink}
            </a>
            .
          </Hint>
        </SeamCard>
      )}
      <RemoveFactorDialog
        factor={removing}
        otherCount={others}
        onRemove={(id) => api.removeFactor(id)}
        onRemoved={(gone) => {
          // The DELETE succeeded: drop the factor locally first so a failed
          // follow-up reload can never leave a removed factor shown as active.
          setState((s) =>
            s.status === 'ready' ? { ...s, factors: s.factors.filter((f) => f.factorId !== gone) } : s
          )
          void reloadQuietly()
        }}
        onClose={() => setRemoving(null)}
        onAddAnother={() => {
          setRemoving(null)
          go(routes.addAuthenticator)
        }}
      />
    </FlowPage>
  )
}
