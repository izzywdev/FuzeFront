import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'
import type { PostureLevel, SecurityOverview } from '../types'

export interface SecurityPostureSummaryProps {
  overview: SecurityOverview
}

/** Derive the coarse posture from the contract data (no vendor names). */
export function derivePosture(overview: SecurityOverview): PostureLevel {
  const { connections, methods } = overview
  return connections.hasPassword && methods.mfa.enabled ? 'good' : 'attention'
}

/**
 * The posture summary banner at the top of the hub. A soft-tinted card with a
 * status glyph and a one-line human summary derived from connections + methods.
 * Tokens-only; the seam accent is the brand signature.
 */
export function SecurityPostureSummary({ overview }: SecurityPostureSummaryProps) {
  const { messages: m, t } = useAccountSecurityI18n()
  const posture = derivePosture(overview)
  const good = posture === 'good'
  const { connections, methods, activeSessions } = overview

  const passwordPart = connections.hasPassword ? m.posture.passwordSet : m.posture.passwordMissing
  const twoFactorPart = methods.mfa.enabled ? m.posture.twoFactorOn : m.posture.twoFactorOff
  const devicesPart =
    activeSessions == null
      ? m.posture.devicesUnknown
      : t(m.badges.activeDevices, { count: activeSessions }) + ' devices'
  const linkedCount = connections.providers.length
  const connectedPart =
    linkedCount === 0
      ? m.posture.connectedNone
      : `${linkedCount} ${linkedCount === 1 ? 'connected account' : 'connected accounts'}`

  const summary = t(m.posture.summary, {
    password: passwordPart,
    twoFactor: twoFactorPart,
    devices: devicesPart,
    connected: connectedPart,
  })

  const tone = good ? 'var(--success-color)' : 'var(--warning-color)'
  const soft = good ? 'var(--success-soft)' : 'var(--warning-soft)'

  return (
    <section
      data-posture={posture}
      aria-label="Security posture"
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5) var(--space-6)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetInlineStart: 0,
          insetInlineEnd: 0,
          top: 0,
          height: 'var(--border-width-strong)',
          background: 'var(--seam)',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 'calc(var(--space-12) + var(--space-2))',
          height: 'calc(var(--space-12) + var(--space-2))',
          borderRadius: 'var(--radius-pill)',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-xl)',
          color: tone,
          background: soft,
          border: `var(--border-width-strong) solid ${tone}`,
        }}
      >
        {good ? '✓' : '!'}
      </span>
      <div>
        <h2
          style={{
            margin: '0 0 var(--space-1)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-lg)',
            color: 'var(--text-primary)',
          }}
        >
          {good ? m.posture.good : m.posture.attention}
        </h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {summary}
        </p>
      </div>
    </section>
  )
}
