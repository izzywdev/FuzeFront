import { useState } from 'react'
import { Badge, Button, StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'
import { ConnectedAccountRow } from './ConnectedAccountRow'
import { HttpError } from '../api/http'
import type { IdentityConnections, SocialConnection } from '../types'

export interface SignInMethodsListProps {
  connections: IdentityConnections
  /**
   * Unlink a provider. Should reject with an `HttpError` (status 409) when the
   * provider is the account's LAST sign-in method — the list then renders the
   * fail-closed last-method guard instead of removing the row.
   */
  onUnlink?: (provider: SocialConnection['provider']) => Promise<void>
  /** Set a password (offered by the last-method guard). */
  onSetPassword?: () => void
  /** Link another provider (offered by the last-method guard). */
  onLinkProvider?: () => void
}

/**
 * The account's ways to sign in: the password method (when set) plus each linked
 * social connection. Unlinking the LAST remaining method is fail-closed — the
 * server returns 409 and this list surfaces the last-sign-in-method guard rather
 * than leaving the account with no way to sign in.
 */
export function SignInMethodsList({
  connections,
  onUnlink,
  onSetPassword,
  onLinkProvider,
}: SignInMethodsListProps) {
  const { messages: m } = useAccountSecurityI18n()
  const [lastMethodGuard, setLastMethodGuard] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const handleUnlink = async (provider: SocialConnection['provider']) => {
    if (!onUnlink) return
    setBusy(provider)
    setLastMethodGuard(false)
    try {
      await onUnlink(provider)
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setLastMethodGuard(true)
      } else {
        throw err
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-panel="sign-in-methods">
      <h3
        style={{
          margin: '0 0 var(--space-3)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-md)',
          color: 'var(--text-primary)',
        }}
      >
        {m.methods.heading}
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {connections.hasPassword && (
          <div
            data-method="password"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <span
              style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}
            >
              {m.methods.passwordName}
            </span>
            <Badge tone="success" dot>
              {m.badges.set}
            </Badge>
          </div>
        )}

        {connections.providers.map((c) => (
          <ConnectedAccountRow
            key={c.provider}
            connection={c}
            onUnlink={onUnlink ? () => void handleUnlink(c.provider) : undefined}
            busy={busy === c.provider}
          />
        ))}
      </div>

      {lastMethodGuard && (
        <div data-state="last-method" style={{ marginTop: 'var(--space-4)' }}>
          <StatusCallout
            tone="warning"
            icon="🔗"
            title={m.lastMethod.title}
            data-guard="last-sign-in-method"
            actions={
              <>
                <Button variant="primary" data-action="set-password" onClick={onSetPassword}>
                  {m.lastMethod.setPassword}
                </Button>
                <Button variant="ghost" data-action="link-provider" onClick={onLinkProvider}>
                  {m.lastMethod.linkProvider}
                </Button>
              </>
            }
          >
            {m.lastMethod.text}
          </StatusCallout>
        </div>
      )}
    </div>
  )
}
