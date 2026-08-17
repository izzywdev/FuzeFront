import { useState } from 'react'
import { Alert, Button, Badge, Input } from '@fuzefront/design-system'
import type { Scope } from '@fuzefront/config-client'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'
import type { ScopeNameResolver } from '../../types'

export type AuditOperation = 'set' | 'unset' | 'lock' | 'unlock' | 'reveal'

export interface AuditEntry {
  id: string | number
  when: string
  op: AuditOperation
  /** Omitted (never present) for a secret key — see `isSecret`. */
  fromValue?: unknown
  toValue?: unknown
  actor: string
  actorScope: Scope
  reason?: string
  /** The entry id this one replays, if it was written by a revert. */
  revertOf?: string | number
  /** True when this row can never carry a value to revert TO (a `lock`/`reveal` row). */
  noRevertTarget?: boolean
}

export interface ConfigSecretAuditFlowProps {
  keyName: string
  scope: Scope
  nameOf: ScopeNameResolver
  /** `null` while loading. */
  entries: AuditEntry[] | null
  loading?: boolean
  error?: string | null
  forbidden?: boolean
  /** Redacts every `fromValue`/`toValue` cell — an audit log holding secret values is a secret store with worse access control. */
  isSecret?: boolean
  onRetry?: () => void
  /** Replays `entry` as a NEW change (never a rewrite of history) — a `set` carrying its `toValue`, or the `unset` it represents. */
  onRevert: (entry: AuditEntry, reason: string) => Promise<void>
}

/**
 * `ConfigSecretAuditFlow` — `/admin/config/keys/:key/history`, flow
 * `secret-audit` (frame 09). Append-only: revert writes a NEW row, it never
 * rewinds or deletes one. Anticipated contract (FF-EPIC-18-S2/S3) — see the
 * package README for what does and does not exist in the frozen spec today.
 */
export function ConfigSecretAuditFlow({
  keyName,
  scope,
  nameOf,
  entries,
  loading = false,
  error = null,
  forbidden = false,
  isSecret = false,
  onRetry,
  onRevert,
}: ConfigSecretAuditFlowProps) {
  const { messages, t } = useConfigI18n()
  const m = messages.audit
  const [revertTarget, setRevertTarget] = useState<AuditEntry | null>(null)
  const [revertReason, setRevertReason] = useState('')
  const [reverting, setReverting] = useState(false)

  if (forbidden) {
    return (
      <div data-state="history-error">
        <Alert tone="error" title={m.forbiddenTitle} data-error-code="FORBIDDEN">
          {t(m.forbiddenBody, { scope: scope.scopeType })}
        </Alert>
      </div>
    )
  }

  if (error) {
    return (
      <div data-state="history-error">
        <Alert tone="error" title={m.loadErrorTitle} data-error-code="LOAD_FAILED">
          {error || m.loadErrorBody}
        </Alert>
        <Button size="sm" onClick={onRetry} data-action="retry" style={{ marginTop: 'var(--space-3)' }}>
          {messages.common.retry}
        </Button>
      </div>
    )
  }

  if (loading || entries === null) {
    return (
      <div data-state="loading" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ height: 40, background: 'var(--bg-quaternary)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)' }} />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div data-state="empty-history">
        <div data-empty="history">
          <h3>{m.emptyTitle}</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>{t(m.emptyBody, { key: keyName, scope: `${scope.scopeType} ${nameOf(scope)}` })}</p>
        </div>
      </div>
    )
  }

  return (
    <div data-audit-timeline>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>When</th>
            <th style={thStyle}>Operation</th>
            <th style={thStyle}>Value</th>
            <th style={thStyle}>Actor &amp; reason</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} data-audit-entry={e.id} data-audit-op={e.op} data-audit-revert-of={e.revertOf}>
              <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{e.when}</td>
              <td style={tdStyle}>
                <Badge tone="neutral" mono size="sm">{e.op}</Badge>
                {e.revertOf != null && (
                  <span style={{ marginInlineStart: 'var(--space-1)' }}>
                    <Badge tone="info" mono size="sm">{t(m.revertOfSuffix, { entryId: e.revertOf })}</Badge>
                  </span>
                )}
              </td>
              <td style={tdStyle} data-redacted={isSecret || undefined}>
                {isSecret ? (
                  <span style={{ color: 'var(--text-tertiary)' }}>{m.secretRedacted}</span>
                ) : e.op === 'unset' ? (
                  <span style={{ color: 'var(--text-tertiary)' }}>override removed</span>
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {e.fromValue !== undefined ? `${String(e.fromValue)} → ` : ''}
                    {String(e.toValue)}
                  </span>
                )}
              </td>
              <td style={tdStyle}>
                <b>{e.actor}</b>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {e.actorScope.scopeType} {nameOf(e.actorScope)} {e.reason ? `· "${e.reason}"` : ''}
                </div>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' as const }}>
                {!isSecret && !e.noRevertTarget && (
                  <Button size="sm" onClick={() => setRevertTarget(e)} data-action="revert-to">
                    {m.revertTo}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {revertTarget && (
        <div data-state="revert-confirm" style={{ marginTop: 'var(--space-6)' }}>
          <Alert tone="warning" title={t(m.revertConfirmTitle, { key: keyName, value: String(revertTarget.toValue) })} data-revert-confirm>
            {m.revertConfirmBody}
          </Alert>
          <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <Input
              label={m.revertReasonPlaceholder}
              placeholder={m.revertReasonPlaceholder}
              value={revertReason}
              onChange={e => setRevertReason(e.target.value)}
              data-revert-reason
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="ghost"
              onClick={() => {
                setRevertTarget(null)
                setRevertReason('')
              }}
              data-action="cancel-revert"
            >
              {messages.common.cancel}
            </Button>
            <Button
              disabled={!revertReason || reverting}
              onClick={async () => {
                setReverting(true)
                try {
                  await onRevert(revertTarget, revertReason)
                  setRevertTarget(null)
                  setRevertReason('')
                } finally {
                  setReverting(false)
                }
              }}
              data-action="confirm-revert"
            >
              {m.confirmRevert}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const thStyle = {
  textAlign: 'left' as const,
  fontSize: 'var(--text-2xs)',
  textTransform: 'uppercase' as const,
  letterSpacing: 'var(--tracking-wide)',
  color: 'var(--text-tertiary)',
  padding: 'var(--space-3) var(--space-6)',
  borderBottom: '1px solid var(--border-color)',
}

const tdStyle = {
  padding: 'var(--space-4) var(--space-6)',
  borderBottom: '1px solid var(--border-color)',
  fontSize: 'var(--text-md)',
  verticalAlign: 'middle' as const,
}
