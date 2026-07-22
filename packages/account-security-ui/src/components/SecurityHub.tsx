import React from 'react'
import { Badge } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'
import { SecurityPostureSummary } from './SecurityPostureSummary'
import { SecurityCard } from './SecurityCard'
import { SetPasswordBanner } from './SetPasswordBanner'
import { SignInMethodsList } from './SignInMethodsList'
import { providerDisplayName } from './providers'
import type { SecurityOverview, SocialConnection } from '../types'

export interface SecurityHubRoutes {
  password: string
  twoFactor: string
  sessions: string
  tokens: string
  connected: string
}

const DEFAULT_ROUTES: SecurityHubRoutes = {
  password: '/account/security/password',
  twoFactor: '/account/security/two-factor',
  sessions: '/account/security/devices',
  tokens: '/account/security/tokens',
  connected: '/account/security/connections',
}

export interface SecurityHubProps {
  overview: SecurityOverview
  onNavigate?: (route: string) => void
  /** Set a password (from the social-only guard, and from the last-method guard). */
  onSetPassword?: () => void
  /**
   * Unlink a social provider. Should reject with an HttpError(409) when it is
   * the account's last sign-in method — SignInMethodsList then renders the
   * fail-closed last-sign-in-method guard instead of removing the row.
   */
  onUnlink?: (provider: SocialConnection['provider']) => Promise<void>
  /** Link another provider (offered by the last-method guard). */
  onLinkProvider?: () => void
  routes?: Partial<SecurityHubRoutes>
}

/**
 * Presentational hub (frame 01): posture summary, an optional social-only
 * set-password guard, and the grid of navigational security cards. Pure — it
 * takes already-loaded overview data; the orchestrator owns fetching/states.
 */
export function SecurityHub({
  overview,
  onNavigate,
  onSetPassword,
  onUnlink,
  onLinkProvider,
  routes,
}: SecurityHubProps) {
  const { messages: m, t } = useAccountSecurityI18n()
  const r = { ...DEFAULT_ROUTES, ...routes }
  const { connections, methods, activeSessions, activeTokens } = overview

  return (
    <div data-panel="security-hub">
      <SecurityPostureSummary overview={overview} />

      {!connections.hasPassword && onSetPassword && (
        <SetPasswordBanner onSetPassword={onSetPassword} />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <SecurityCard
          cardKey="password"
          route={r.password}
          onNavigate={onNavigate}
          icon="🔑"
          title={m.cards.password.title}
          desc={m.cards.password.desc}
          badge={
            connections.hasPassword ? (
              <Badge tone="success" dot>
                {m.badges.set}
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                {m.posture.passwordMissing}
              </Badge>
            )
          }
        />

        <SecurityCard
          cardKey="two-factor"
          route={r.twoFactor}
          onNavigate={onNavigate}
          icon="📱"
          title={m.cards.twoFactor.title}
          desc={m.cards.twoFactor.desc}
          badge={
            methods.mfa.enabled ? (
              <Badge tone="success" dot>
                {m.badges.on}
              </Badge>
            ) : (
              <Badge tone="neutral">{m.posture.twoFactorOff}</Badge>
            )
          }
        />

        <SecurityCard
          cardKey="sessions"
          route={r.sessions}
          onNavigate={onNavigate}
          icon="💻"
          title={m.cards.sessions.title}
          desc={m.cards.sessions.desc}
          badge={
            <Badge tone="neutral">
              {activeSessions == null
                ? m.badges.unknown
                : t(m.badges.activeDevices, { count: activeSessions })}
            </Badge>
          }
        />

        <SecurityCard
          cardKey="tokens"
          route={r.tokens}
          onNavigate={onNavigate}
          icon="🔓"
          title={m.cards.tokens.title}
          desc={m.cards.tokens.desc}
          badge={
            <Badge tone="neutral">
              {activeTokens == null
                ? m.badges.unknown
                : t(m.badges.activeTokens, { count: activeTokens })}
            </Badge>
          }
        />

        <SecurityCard
          cardKey="connected"
          route={r.connected}
          onNavigate={onNavigate}
          fullWidth
          icon="🔗"
          title={m.cards.connected.title}
          desc={m.cards.connected.desc}
          badge={
            <>
              {connections.providers.map((c) => (
                <Badge key={c.provider} tone="accent" dot>
                  {providerDisplayName(c.provider)} · {m.badges.linked}
                </Badge>
              ))}
              {connections.hasPassword && (
                <Badge tone="neutral">{m.badges.passwordEnabled}</Badge>
              )}
            </>
          }
        />
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        <SignInMethodsList
          connections={connections}
          onUnlink={onUnlink}
          onSetPassword={onSetPassword}
          onLinkProvider={onLinkProvider}
        />
      </div>
    </div>
  )
}
