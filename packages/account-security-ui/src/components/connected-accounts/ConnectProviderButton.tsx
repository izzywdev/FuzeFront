import { Button } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'
import { providerDisplayName } from './providers'
import type { SocialProvider } from '../../types'

export interface ConnectProviderButtonProps {
  provider: SocialProvider
  /** Begin the connect flow for this provider. */
  onConnect: (provider: SocialProvider) => void
  /** Disable the affordance (e.g. a connect handshake is already in flight). */
  busy?: boolean
}

/**
 * "Add a way to sign in" affordance for a provider the account has NOT yet
 * linked (frame 01, `[data-connect='<provider>']`). Composed from the
 * design-system `Button` + tokens only — no one-off styling. Distinct from
 * `ConnectedAccountRow`, which renders an already-linked provider.
 */
export function ConnectProviderButton({ provider, onConnect, busy }: ConnectProviderButtonProps) {
  const { messages: m, t } = useAccountSecurityI18n()
  const name = providerDisplayName(provider)
  return (
    <div
      data-connect={provider}
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
        {t(m.connections.continueWith, { provider: name })}
      </span>
      <Button
        variant="primary"
        size="sm"
        data-action="connect"
        data-provider={provider}
        disabled={busy}
        onClick={() => onConnect(provider)}
      >
        {t(m.connections.connectButton, { provider: name })}
      </Button>
    </div>
  )
}
