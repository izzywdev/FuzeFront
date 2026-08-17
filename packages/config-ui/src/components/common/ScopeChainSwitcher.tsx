import { Breadcrumb } from '@fuzefront/design-system'
import type { ScopeChainStep } from '../../types'
import type { Scope } from '@fuzefront/config-client'

export interface ScopeChainSwitcherProps {
  /** The full platform→portal→user chain, in resolution order. */
  chain: ScopeChainStep[]
  /** The scope currently being edited/viewed. */
  activeScope: Scope
  /** Called when the user picks a different reachable scope. Omit to render non-interactive. */
  onSelect?: (scope: Scope) => void
  namespace?: string
  version?: string
}

function sameScope(a: Scope, b: Scope): boolean {
  return a.scopeType === b.scopeType && (a.scopeId ?? null) === (b.scopeId ?? null)
}

/**
 * The persistent scope-chain control — 01-settings-editor.html `.scopebar`.
 * The resolution chain is the mental model of the whole console, so it is
 * always visible, not a dropdown buried in a menu. Composes the DS
 * `Breadcrumb` with `kind` set per step (platform/portal/org/user).
 */
export function ScopeChainSwitcher({ chain, activeScope, onSelect, namespace, version }: ScopeChainSwitcherProps) {
  return (
    <div
      data-scope-switcher
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
        padding: 'var(--space-4) var(--space-6)',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
      }}
    >
      <Breadcrumb
        items={chain.map(step => ({
          key: `${step.scope.scopeType}:${step.scope.scopeId ?? ''}`,
          kind: step.scope.scopeType,
          label: step.name,
          current: sameScope(step.scope, activeScope),
          onClick: onSelect ? () => onSelect(step.scope) : undefined,
        }))}
      />
      <span style={{ flex: 1 }} />
      {namespace && (
        <span
          data-namespace-picker
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            background: 'var(--bg-quaternary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
          }}
        >
          namespace: {namespace}
        </span>
      )}
      {version && (
        <span
          data-config-version
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}
        >
          ETag {version}
        </span>
      )}
    </div>
  )
}
