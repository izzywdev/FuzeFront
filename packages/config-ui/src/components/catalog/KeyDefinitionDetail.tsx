import { Badge } from '@fuzefront/design-system'
import type { KeyDefinition, Scope } from '@fuzefront/config-client'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'
import type { ScopeNameResolver } from '../../types'

export interface ChainStep {
  scope: Scope
  /** This tier's own value, or undefined if it has no override (inherits the row above). */
  value?: unknown
  /** True when this is the value actually in force (the resolved read). */
  effective?: boolean
  /** True when THIS tier holds a lock (its value is pinned, writes beneath refused). */
  locked?: boolean
  lockReason?: string | null
  /** True when this tier is unreachable because an ancestor above it is locked. */
  blocked?: boolean
}

export interface KeyDefinitionDetailProps {
  definition: KeyDefinition
  /** `default` (the definition's own defaultValue) followed by platform → user, in resolution order. */
  chain: ChainStep[]
  nameOf: ScopeNameResolver
  onViewHistory?: () => void
}

/** `/admin/config/catalog/:key` — frame 06. Read-only. */
export function KeyDefinitionDetail({ definition: def, chain, nameOf, onViewHistory }: KeyDefinitionDetailProps) {
  const { messages } = useConfigI18n()
  const m = messages.definition

  const effective = chain.find(s => s.effective)
  const noDivergence = chain.every(s => s.value === undefined || s === effective)

  return (
    <div>
      <div data-definition-facts style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <Badge tone="neutral" mono>{def.valueType}</Badge>
          {def.requiresRestart && <Badge tone="info" mono>requires restart</Badge>}
          {def.isSystem && <Badge tone="info" mono>system</Badge>}
          {def.isHidden && <Badge tone="error" mono>hidden</Badge>}
          {def.isSecret && <Badge tone="warning" mono>secret</Badge>}
          {def.isReadonly && <Badge tone="neutral" mono>readonly</Badge>}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Fact label="displayName" value={def.displayName} />
            <Fact label="valueType" value={def.valueType} mono />
            {def.enumValues && <Fact label="enumValues" value={def.enumValues.join(' · ')} mono />}
            <Fact label="defaultValue" value={def.isSecret ? messages.catalog.secretDefault : String(def.defaultValue)} mono />
            <Fact label="allowedScopes" value={def.allowedScopes.join(' · ')} mono />
            <Fact label="precedence" value={def.precedence} mono />
            {def.category && <Fact label="category / sortOrder" value={`${def.category} / ${def.sortOrder ?? ''}`} />}
            {def.tags && def.tags.length > 0 && <Fact label="tags" value={def.tags.join(' · ')} mono />}
            <Fact
              label="isSystem / isHidden / isSecret / isReadonly"
              value={`${def.isSystem} · ${def.isHidden} · ${def.isSecret} · ${def.isReadonly}`}
              mono
            />
            <Fact label="requiresRestart" value={String(def.requiresRestart)} mono />
            {def.deprecatedAt && <Fact label="deprecatedAt / replacedBy" value={`${def.deprecatedAt} / ${def.replacedBy ?? '—'}`} />}
          </tbody>
        </table>
      </div>

      {noDivergence ? (
        <p
          data-no-divergence={def.key}
          style={{
            border: '1px solid var(--success-color)',
            background: 'var(--success-soft)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
          }}
        >
          <b style={{ display: 'block' }}>{m.noDivergenceTitle}</b>
          <span>{m.noDivergenceBody.replace('{key}', def.key).replace('{value}', String(def.defaultValue))}</span>
        </p>
      ) : (
        <div data-resolution-chain>
          {chain.map(step => (
            <div
              key={`${step.scope.scopeType}:${step.scope.scopeId ?? ''}`}
              data-chain-step={step.scope.scopeType}
              data-chain-effective={step.effective || undefined}
              data-chain-locked={step.locked || undefined}
              data-chain-blocked={step.blocked || undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) max-content minmax(0, 1fr)',
                gap: 'var(--space-4)',
                alignItems: 'center',
                padding: 'var(--space-3) 0',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: step.blocked ? 'var(--text-tertiary)' : step.effective ? 'var(--accent-2)' : 'var(--text-tertiary)',
                }}
              >
                {step.blocked ? m.lockedChainUnreachable : step.value === undefined ? '—' : String(step.value)}
                {step.locked && ' 🔒'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{step.blocked ? '×' : '↓'}</span>
              <span>
                <b>
                  {step.scope.scopeType} {nameOf(step.scope)}
                  {step.effective ? ` — ${m.inForceSuffix}` : ''}
                </b>
                {step.lockReason && (
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    lockReason: &quot;{step.lockReason}&quot;
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {onViewHistory && (
        <button type="button" data-open-history onClick={onViewHistory} style={{ marginTop: 'var(--space-4)' }}>
          {m.viewHistory}
        </button>
      )}
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-tertiary)' }}>{label}</td>
      <td style={{ padding: 'var(--space-2) var(--space-4)', fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</td>
    </tr>
  )
}
