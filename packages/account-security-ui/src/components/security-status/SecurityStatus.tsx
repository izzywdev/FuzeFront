import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Skeleton } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import type { ContactClient, MfaClient, MfaFactor, VerificationStatus } from '../../types'
import {
  CardHeading,
  FlowRoot,
  Hint,
  SeamCard,
  useSecurityClient,
  type FlowBaseProps,
} from '../common/flowKit'
import { FACTOR_ICON, activeFactors, factorName, maskPhone } from '../mfa/factorMeta'
import { DEFAULT_MFA_ROUTES, type MfaRoutes } from '../mfa/MfaOverview'
import { RemoveFactorDialog } from '../mfa/RemoveFactorDialog'

type StatusKind = 'active' | 'verified' | 'unverified'
const TONE: Record<StatusKind, 'success' | 'warning'> = {
  active: 'success',
  verified: 'success',
  unverified: 'warning',
}

/** One row of the combined status list. Chips render ONLY confirmed server state. */
export function SecurityStatusRow({
  icon,
  title,
  sub,
  status,
  statusLabel,
  action,
  rowAttrs,
}: {
  icon: string
  title: string
  sub?: string
  status: StatusKind
  statusLabel: string
  action?: React.ReactNode
  rowAttrs?: Record<string, string>
}) {
  return (
    <div
      {...rowAttrs}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minHeight: 'calc(var(--touch-target) + var(--space-4))',
        padding: 'var(--space-3) 0',
        borderBlockEnd: '1px solid var(--border-color)',
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <b style={{ fontWeight: 'var(--weight-semibold)' }}>{title}</b>
        {sub && <small style={{ color: 'var(--text-tertiary)' }}>{sub}</small>}
        <span data-status={status} style={{ alignSelf: 'flex-start' }}>
          <Badge tone={TONE[status]} dot>
            {statusLabel}
          </Badge>
        </span>
      </span>
      {action}
    </div>
  )
}

export function SecurityStatusList({
  factors,
  status,
  onRemove,
  onAddFactor,
  onVerifyPhone,
  addMethodEnabled = true,
  phoneVerifyAvailable = false,
}: {
  factors: MfaFactor[]
  status: VerificationStatus
  onRemove: (f: MfaFactor) => void
  onAddFactor: () => void
  onVerifyPhone: () => void
  /** False when the MFA-management surface it routes to is not available (flag OFF). */
  addMethodEnabled?: boolean
  /**
   * Text-message delivery is confirmed available (`methods.verification.sms`). FAIL CLOSED: when
   * false/unknown the phone Verify action is hidden, because the flow it opens can never complete.
   */
  phoneVerifyAvailable?: boolean
}) {
  const { messages: m } = useAccountSecurityI18n()
  const active = activeFactors(factors)
  const touchBtn = {
    minWidth: 'var(--touch-target)',
    minHeight: 'var(--touch-target)',
  } as const
  return (
    <>
      <Hint style={{ margin: 'var(--space-4) 0 var(--space-1)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
        {m.securityStatus.twoFactor}
      </Hint>
      {active.length === 0 && <Hint>{m.securityStatus.noFactors}</Hint>}
      {active.map((f, i) => (
        <SecurityStatusRow
          key={f.factorId}
          rowAttrs={{ 'data-factor': f.type }}
          icon={FACTOR_ICON[f.type]}
          title={factorName(m, f.type)}
          sub={f.type === 'sms' || f.type === 'email' ? (f.label ?? '') : active.length === 1 ? m.securityStatus.onlyActive : i === 0 ? m.securityStatus.primary : undefined}
          status="active"
          statusLabel={m.securityStatus.active}
          action={
            <Button
              variant="ghost"
              data-action="remove-factor"
              data-factor-id={f.factorId}
              aria-label={`${m.securityStatus.remove}: ${factorName(m, f.type)}`}
              style={touchBtn}
              onClick={() => onRemove(f)}
            >
              ⋯
            </Button>
          }
        />
      ))}
      {addMethodEnabled ? (
        <Button variant="ghost" fullWidth data-action="add-factor" onClick={onAddFactor} style={{ margin: 'var(--space-3) 0 var(--space-5)' }}>
          {m.securityStatus.addMethod}
        </Button>
      ) : (
        // The add-method route is gated by the MFA-management flag: say so instead of a dead link.
        <Hint data-state="add-unavailable" style={{ margin: 'var(--space-3) 0 var(--space-5)' }}>
          {m.securityStatus.addUnavailable}
        </Hint>
      )}

      <Hint style={{ margin: 'var(--space-4) 0 var(--space-1)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
        {m.securityStatus.contact}
      </Hint>
      <SecurityStatusRow
        rowAttrs={{ 'data-channel': 'email' }}
        icon="✉️"
        title={m.securityStatus.email}
        sub={m.securityStatus.emailUnknown}
        status={status.emailVerified ? 'verified' : 'unverified'}
        statusLabel={status.emailVerified ? m.securityStatus.verified : m.securityStatus.unverified}
      />
      <SecurityStatusRow
        rowAttrs={{ 'data-channel': 'phone' }}
        icon="📱"
        title={m.securityStatus.phone}
        sub={status.phone ? maskPhone(status.phone) : m.securityStatus.notConfirmed}
        status={status.phoneVerified ? 'verified' : 'unverified'}
        statusLabel={status.phoneVerified ? m.securityStatus.verified : m.securityStatus.unverified}
        action={
          status.phoneVerified || !phoneVerifyAvailable ? undefined : (
            <Button
              variant="ghost"
              data-action="verify-phone"
              aria-label={`${m.securityStatus.verify}: ${m.securityStatus.phone}`}
              style={touchBtn}
              onClick={onVerifyPhone}
            >
              {m.securityStatus.verify}
            </Button>
          )
        }
      />
    </>
  )
}

export interface SecurityStatusMobileFlowProps extends FlowBaseProps {
  onNavigate?: (route: string) => void
  routes?: Partial<MfaRoutes> & { verifyPhone?: string }
  /**
   * Whether the MFA-management routes (add method) are reachable. The host passes the
   * `fuzefront.security.mfa-management` flag; OFF hides "Add a method" (explained, not a dead link).
   */
  addMethodEnabled?: boolean
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; factors: MfaFactor[]; verification: VerificationStatus; smsAvailable: boolean }

/**
 * Combined mobile 2FA + contact-verification status (frame 04, 375px, additive to
 * the desktop hub). Renders only CONFIRMED server state: a failed load shows a
 * retry, never a stale guess. Removing the only active factor under an enforced
 * policy is blocked by the server (409) and surfaced in the bottom-sheet dialog.
 */
export function SecurityStatusMobileFlow(props: SecurityStatusMobileFlowProps) {
  return (
    <FlowRoot locale={props.locale}>
      <SecurityStatusInner {...props} />
    </FlowRoot>
  )
}

function SecurityStatusInner({ client, getToken, onNavigate, routes, addMethodEnabled = true }: SecurityStatusMobileFlowProps) {
  const { messages: m, dir } = useAccountSecurityI18n()
  const api = useSecurityClient<MfaClient & ContactClient>(client, getToken)
  const r = { ...DEFAULT_MFA_ROUTES, verifyPhone: '/account/security/verify/phone', ...routes }
  const go = (route: string) => onNavigate?.(route)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [removing, setRemoving] = useState<MfaFactor | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [factors, verification, smsAvailable] = await Promise.all([
        api.listFactors(),
        api.getVerificationStatus(),
        // A failed capability read must not break the status screen, but it fails closed: no phone Verify.
        api.getMethods().then((mm) => mm.verification?.sms === true, () => false),
      ])
      if (alive.current) setState({ status: 'ready', factors, verification, smsAvailable })
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

  const others =
    state.status === 'ready' && removing
      ? activeFactors(state.factors).filter((f) => f.factorId !== removing.factorId).length
      : 0

  return (
    <section dir={dir} data-frame="04-security-status" data-viewport="375" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', textAlign: 'start' }}>
      <h2
        style={{
          margin: '0 0 var(--space-2)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xl)',
        }}
      >
        {m.securityStatus.title}
      </h2>
      {state.status === 'loading' && (
        <div
          data-panel="security-status"
          data-state="loading"
          aria-busy="true"
          role="status"
          aria-label={m.securityStatus.loadingLabel}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="var(--space-12)" radius="var(--radius-md)" />
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <div data-panel="security-status" data-state="error">
          <SeamCard tone="danger" data-state="load-error">
            <CardHeading>{m.securityStatus.errorTitle}</CardHeading>
            <Hint>{m.securityStatus.errorText}</Hint>
            <Button variant="primary" data-action="retry" onClick={() => void load()}>
              {m.securityStatus.retry}
            </Button>
          </SeamCard>
        </div>
      )}
      {state.status === 'ready' && (
        <div data-panel="security-status" data-state="loaded">
          <SecurityStatusList
            factors={state.factors}
            status={state.verification}
            onRemove={setRemoving}
            onAddFactor={() => go(r.addAuthenticator)}
            onVerifyPhone={() => go(r.verifyPhone)}
            addMethodEnabled={addMethodEnabled}
            phoneVerifyAvailable={state.smsAvailable}
          />
        </div>
      )}
      <RemoveFactorDialog
        presentation="sheet"
        factor={removing}
        canAddAnother={addMethodEnabled}
        otherCount={others}
        onRemove={(id) => api.removeFactor(id)}
        onRemoved={() => void load()}
        onClose={() => setRemoving(null)}
        onAddAnother={() => {
          setRemoving(null)
          go(r.addAuthenticator)
        }}
      />
    </section>
  )
}
