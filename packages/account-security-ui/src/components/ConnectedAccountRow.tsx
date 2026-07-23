import { Badge, Button } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'
import { providerDisplayName } from './providers'
import type { SocialConnection } from '../types'

export interface ConnectedAccountRowProps {
  connection: SocialConnection
  /** Invoked to unlink this provider. May reject with a 409 last-method guard. */
  onUnlink?: (provider: SocialConnection['provider']) => void
  /** Disable the unlink control (e.g. an unlink is in flight). */
  busy?: boolean
}

/**
 * One linked social sign-in connection: provider name, a "linked" badge, and an
 * unlink control. Layout uses logical properties so it mirrors under RTL.
 */
export function ConnectedAccountRow({ connection, onUnlink, busy }: ConnectedAccountRowProps) {
  const { messages: m } = useAccountSecurityI18n()
  const name = providerDisplayName(connection.provider)
  return (
    <div
      data-connection={connection.provider}
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
      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
        {name}
      </span>
      <Badge tone="success" dot>
        {m.badges.linked}
      </Badge>
      {onUnlink && (
        <Button
          variant="ghost"
          size="sm"
          data-action="unlink"
          disabled={busy}
          onClick={() => onUnlink(connection.provider)}
        >
          {m.methods.remove}
        </Button>
      )}
    </div>
  )
}
