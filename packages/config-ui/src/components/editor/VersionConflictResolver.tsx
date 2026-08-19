import { Button } from '@fuzefront/design-system'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'
import { ErrorCodeTag } from '../common/ErrorCodeTag'

export interface ConflictEntry {
  key: string
  /** The value now on the server (peer edit OR an inherited/ancestor change). */
  theirValue: unknown
  /** The caller's pending, unsaved value. */
  yourValue: unknown
  /** Human-facing note on WHO/WHERE changed it — "changed by j.okafor · 2 min ago" or "changed at portal Acme Portal — inherited change". */
  changedBy: string
}

export interface VersionConflictResolverProps {
  loadedVersion: string
  currentVersion: string
  conflicts: ConflictEntry[]
  /** Per-key theirs/yours choice, keyed by `ConflictEntry.key`. Defaults to "yours" (the caller's pending edit) until toggled. */
  picks: Record<string, 'theirs' | 'yours'>
  onPickChange: (key: string, pick: 'theirs' | 'yours') => void
  onDiscardMine: () => void
  /** Re-submits the save against `currentVersion` with the resolved picks — never a blind retry of the stale write. */
  onSaveMerged: () => void
}

/**
 * VERSION_CONFLICT resolution — 04-save-conflict.html. Per-key Theirs/Yours,
 * no blind Retry and no force-save affordance: the only way to make a blind
 * retry succeed is to drop `expectedVersion`, which silently destroys the
 * concurrent edit this dialog exists to surface.
 */
export function VersionConflictResolver({
  loadedVersion,
  currentVersion,
  conflicts,
  picks,
  onPickChange,
  onDiscardMine,
  onSaveMerged,
}: VersionConflictResolverProps) {
  const { messages, t } = useConfigI18n()
  const m = messages.save

  return (
    <div data-state="version-conflict">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)' }}>{m.versionConflictTitle}</h2>
        <ErrorCodeTag code="VERSION_CONFLICT" />
      </div>
      <p
        data-conflict-banner
        style={{
          border: '1px solid var(--warning-color)',
          background: 'var(--warning-soft)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          margin: '0 0 var(--space-4)',
        }}
      >
        <b style={{ display: 'block' }}>Nothing was saved.</b>
        <span>{t(m.versionConflictBody, { loadedVersion, currentVersion })}</span>
      </p>

      <table data-conflict-table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Key</th>
            <th style={thStyle}>{m.conflictTheirs}</th>
            <th style={thStyle}>{m.conflictYours}</th>
            <th style={thStyle}>Keep</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map(c => {
            const pick = picks[c.key] ?? 'yours'
            return (
              <tr key={c.key} data-conflict-row={c.key}>
                <td style={tdStyle}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{c.key}</span>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.changedBy}</div>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--cyan-400, var(--accent-2))' }}>
                  {String(c.theirValue)}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>{String(c.yourValue)}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <Button
                      variant={pick === 'theirs' ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-pressed={pick === 'theirs'}
                      data-keep="theirs"
                      onClick={() => onPickChange(c.key, 'theirs')}
                    >
                      {m.conflictTheirs}
                    </Button>
                    <Button
                      variant={pick === 'yours' ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-pressed={pick === 'yours'}
                      data-keep="yours"
                      onClick={() => onPickChange(c.key, 'yours')}
                    >
                      {m.conflictYours}
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) 0 0',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          <b data-conflict-count>{conflicts.length}</b> keys to resolve
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onDiscardMine} data-action="discard-mine">
          {m.conflictDiscardMine}
        </Button>
        <Button onClick={onSaveMerged} data-action="save-merged">
          {t(m.conflictSaveMerged, { version: currentVersion })}
        </Button>
      </div>
      {/* Deliberately no "Force save" / "Retry" control here. */}
    </div>
  )
}

const thStyle = {
  textAlign: 'left' as const,
  fontSize: 'var(--text-2xs)',
  textTransform: 'uppercase' as const,
  letterSpacing: 'var(--tracking-wide)',
  color: 'var(--text-tertiary)',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
}

const tdStyle = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'top' as const,
  fontSize: 'var(--text-sm)',
}
