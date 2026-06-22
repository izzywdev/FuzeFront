import React, { useState } from 'react'
import { DataTable, Badge, Button, IconButton } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { EmptyState } from '../common/EmptyState'
import { RevokeConfirmDialog } from './RevokeConfirmDialog'
import { expiresSoon, formatDate } from '../common/dates'
import type { ApiTokenSummary } from '../../types'

export interface TokenListProps {
  tokens: ApiTokenSummary[]
  loading?: boolean
  error?: string | null
  onRevoke: (tokenId: string) => Promise<void>
  onRetry?: () => void
}

/**
 * Lists API tokens with type, scopes, expiry and last-used columns, an expiry
 * warning for tokens within 14 days, and a per-row revoke flow.
 */
export function TokenList({ tokens, loading, error, onRevoke, onRetry }: TokenListProps) {
  const { messages, locale } = useIdentityI18n()
  const t = messages.tokens
  const [revoking, setRevoking] = useState<ApiTokenSummary | null>(null)

  const columns = [
    { key: 'name', header: t.name },
    { key: 'type', header: t.type },
    { key: 'scopes', header: t.scopes },
    { key: 'expires', header: t.expires },
    { key: 'lastUsed', header: t.lastUsed },
    { key: 'actions', header: messages.common.actions, align: 'right' as const },
  ]

  if (error) {
    return <EmptyState variant="error" message={error} actionLabel={messages.common.retry} onAction={onRetry} />
  }

  const cellStyle: React.CSSProperties = {
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
  }

  return (
    <>
      <DataTable
        columns={columns}
        loading={loading}
        emptyState={<EmptyState variant="no-tokens" title={t.emptyTitle} message={t.emptyBody} />}
      >
        {tokens.length > 0 && (
          <tbody>
            {tokens.map((token) => {
              const soon = expiresSoon(token.expires_at)
              return (
                <tr key={token.id}>
                  <td style={cellStyle}>{token.name}</td>
                  <td style={cellStyle}>
                    <Badge tone={token.owner_type === 'org' ? 'accent' : 'neutral'}>
                      {token.owner_type === 'org' ? t.typeService : t.typePat}
                    </Badge>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                      {token.scopes.map((s) => (
                        <Badge key={s} tone="neutral" mono size="sm">
                          {messages.scopeLabels[s] ?? s}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {formatDate(token.expires_at, locale) ?? t.never}
                      {soon && (
                        <Badge tone="warning" size="sm" dot>
                          {t.expiresSoon}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td style={cellStyle}>{formatDate(token.last_used_at, locale) ?? t.never}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" onClick={() => setRevoking(token)}>
                      {t.revoke}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        )}
      </DataTable>

      <RevokeConfirmDialog
        open={!!revoking}
        title={t.revokeTitle}
        message={t.revokeConfirm}
        subject={revoking ? `${revoking.name} · ${revoking.token_prefix}…` : undefined}
        confirmLabel={t.revoke}
        onCancel={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return
          await onRevoke(revoking.id)
          setRevoking(null)
        }}
      />
    </>
  )
}
