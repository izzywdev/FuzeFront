import type { EffectiveConfigEntry, Scope } from '@fuzefront/config-client'
import { Badge } from '@fuzefront/design-system'
import { deriveProvenance, formatScope } from '../../lib/provenance'
import { ProvenanceBadge } from '../common/ProvenanceBadge'
import { ResetValueMenu } from './ResetValueMenu'
import { TypedValueInput } from './TypedValueInput'
import { SecretField } from './SecretField'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'
import type { ScopeNameResolver } from '../../types'

export interface SettingRowProps {
  entry: EffectiveConfigEntry
  editingScope: Scope
  nameOf: ScopeNameResolver
  /** The current in-progress value (may differ from `entry.value` while dirty). */
  draftValue: unknown
  dirty: boolean
  fieldError?: string
  onChange: (value: unknown) => void
  onUnset: () => void
  onPin: () => void
  /** The immediate parent's resolved value/scope, for the pin-parent preview. Undefined at the topmost tier. */
  parent?: { scope: Scope; value: unknown }
  // secret-only
  secretIsSet?: boolean
  secretUnavailable?: boolean
  canRevealSecret?: boolean
  onSecretReplace?: (value: string) => void
  onSecretReveal?: (reason: string) => Promise<string>
}

/**
 * One `EffectiveConfigEntry`, rendered per its exact provenance shape — never
 * a bare value. 01-settings-editor.html `.entry` / 02-provenance-and-lock.html.
 */
export function SettingRow({
  entry,
  editingScope,
  nameOf,
  draftValue,
  dirty,
  fieldError,
  onChange,
  onUnset,
  onPin,
  parent,
  secretIsSet,
  secretUnavailable,
  canRevealSecret,
  onSecretReplace,
  onSecretReveal,
}: SettingRowProps) {
  const { messages, t } = useConfigI18n()
  const m = messages.editor
  const def = entry.definition
  const provenance = deriveProvenance(entry, editingScope)
  const scopeLabel = formatScope(entry.source, nameOf)
  const scopeNotAllowed = !def.allowedScopes.includes(editingScope.scopeType)
  const disabled = entry.locked || def.isReadonly || scopeNotAllowed || !entry.editable

  const provenanceLabel =
    provenance === 'locked'
      ? t(m.provenanceLocked, { scope: scopeLabel })
      : provenance === 'set'
        ? t(m.provenanceSet, { scope: scopeLabel }) + (!entry.editable ? ' · editable: false' : '')
        : provenance === 'inherited'
          ? t(m.provenanceInherited, { scope: scopeLabel })
          : provenance === 'stale'
            ? m.provenanceStale
            : m.provenanceDefault

  return (
    <div
      data-entry={def.key}
      data-dirty={dirty || undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)',
        gap: 'var(--space-4) var(--space-6)',
        padding: 'var(--space-5) var(--space-6)',
        borderTop: '1px solid var(--border-color)',
        background: dirty ? 'var(--accent-soft)' : entry.locked ? 'var(--bg-tertiary)' : undefined,
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
        <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
          {def.displayName}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {def.key}
        </span>
        {def.description && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0, maxWidth: '52ch' }}>
            {def.description}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          <Badge tone="neutral" mono size="sm">{def.valueType}</Badge>
          {def.requiresRestart && <Badge tone="info" mono size="sm">requires restart</Badge>}
          {def.deprecatedAt && <Badge tone="error" mono size="sm">deprecated</Badge>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
        {def.isSecret ? (
          <SecretField
            keyName={def.key}
            isSet={Boolean(secretIsSet)}
            unavailable={secretUnavailable}
            editable={entry.editable && !disabled}
            canReveal={canRevealSecret}
            onReplace={value => onSecretReplace?.(value)}
            onClear={onUnset}
            onReveal={onSecretReveal}
          />
        ) : (
          <TypedValueInput
            definition={def}
            value={draftValue}
            disabled={disabled}
            hooks={{ 'data-value-input': def.key, 'data-field-error': fieldError ? def.key : undefined }}
            onChange={onChange}
          />
        )}

        {!def.isSecret && <ProvenanceBadge kind={provenance} label={provenanceLabel} />}

        {fieldError && (
          <p role="alert" data-field-error={def.key} style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--error-color)' }}>
            {fieldError}
          </p>
        )}

        {entry.locked && (
          <p
            data-locked-by={`${entry.lockedBy?.scopeType}:${entry.lockedBy ? nameOf(entry.lockedBy) : ''}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              background: 'var(--warning-soft)',
              border: '1px solid var(--warning-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              margin: 0,
            }}
          >
            <span aria-hidden="true">🔒</span>
            <span>
              <b>{entry.lockedBy ? formatScope(entry.lockedBy, nameOf) : 'an ancestor'}</b> locked this value.
              {entry.lockReason && (
                <span style={{ display: 'block', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                  lockReason: &quot;{entry.lockReason}&quot;
                </span>
              )}
            </span>
          </p>
        )}

        {!entry.locked && scopeNotAllowed && (
          <p
            data-error-code="SCOPE_NOT_ALLOWED"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              background: 'var(--warning-soft)',
              border: '1px solid var(--warning-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              margin: 0,
            }}
          >
            <b style={{ display: 'block' }}>{t(m.scopeNotAllowedTitle, { scope: editingScope.scopeType })}</b>
            <span>{t(m.scopeNotAllowedBody, { allowedScopes: def.allowedScopes.join(', ') })}</span>
          </p>
        )}

        {!entry.locked && !scopeNotAllowed && def.isReadonly && (
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
              margin: 0,
            }}
          >
            {m.readonlyBody}
          </p>
        )}

        {def.requiresRestart && (
          <p
            data-requires-restart={def.key}
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              background: 'var(--warning-soft)',
              border: '1px solid var(--warning-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              margin: 0,
            }}
          >
            <b style={{ display: 'block' }}>{m.requiresRestartTitle}</b>
            <span style={{ color: 'var(--text-tertiary)' }}>{m.requiresRestartBody}</span>
          </p>
        )}

        {provenance === 'stale' && entry.warning && (
          <p
            data-warning="stale-definition"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              background: 'var(--error-soft)',
              border: '1px solid var(--error-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              margin: 0,
            }}
          >
            {entry.warning}
          </p>
        )}

        {!def.isSecret && provenance === 'set' && !disabled && parent && (
          <ResetValueMenu
            keyName={def.key}
            parentScopeLabel={formatScope(parent.scope, nameOf)}
            parentValue={parent.value}
            onUnset={onUnset}
            onPin={onPin}
          />
        )}
        {/* The host hasn't supplied the ancestor's own value (parentValueOf) —
            offer Unset alone rather than guess a value to pin. */}
        {!def.isSecret && provenance === 'set' && !disabled && !parent && (
          <button type="button" data-op="unset" data-reset-menu={def.key} onClick={onUnset} style={unsetOnlyStyle}>
            Unset
          </button>
        )}

        {!def.isSecret && provenance === 'stale' && !disabled && (
          <button
            type="button"
            data-op="unset"
            onClick={onUnset}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1) var(--space-3)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Unset{parent ? ` — inherit from ${formatScope(parent.scope, nameOf)}` : ''}
          </button>
        )}

        {!def.isSecret && def.allowedScopes.length > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
            allowedScopes: {def.allowedScopes.join(', ')}
          </span>
        )}
      </div>
    </div>
  )
}

const unsetOnlyStyle = {
  alignSelf: 'flex-start' as const,
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-1) var(--space-3)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
}
