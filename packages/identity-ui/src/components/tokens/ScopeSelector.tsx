import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { SCOPE_GROUPS, type ScopeGroupKey } from './scopes'

export interface ScopeSelectorProps {
  /** Currently selected scope strings. */
  value: string[]
  /** Called with the next scope array on toggle. */
  onChange: (scopes: string[]) => void
  /**
   * Scopes the owner is actually permitted to grant. Scopes outside this set
   * are disabled. When omitted, all scopes are enabled.
   */
  availableScopes?: string[]
  disabled?: boolean
}

/**
 * Grouped scope checkbox group built on design-system tokens. Each scope shows
 * its human-readable label; scopes beyond the owner's permissions are disabled.
 */
export function ScopeSelector({ value, onChange, availableScopes, disabled }: ScopeSelectorProps) {
  const { messages } = useIdentityI18n()
  const selected = new Set(value)
  const available = availableScopes ? new Set(availableScopes) : null

  function toggle(scope: string) {
    const next = new Set(selected)
    if (next.has(scope)) next.delete(scope)
    else next.add(scope)
    // Preserve catalogue order for deterministic output.
    onChange(SCOPE_GROUPS.flatMap((g) => g.scopes).filter((s) => next.has(s)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {SCOPE_GROUPS.map((group) => (
        <fieldset
          key={group.key}
          style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
        >
          <legend
            style={{
              padding: 0,
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {messages.scopeGroups[group.key as ScopeGroupKey]}
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {group.scopes.map((scope) => {
              const isDisabled = disabled || (available ? !available.has(scope) : false)
              const labelText = messages.scopeLabels[scope] ?? scope
              return (
                <label
                  key={scope}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-sm)',
                    color: isDisabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDisabled ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={labelText}
                    checked={selected.has(scope)}
                    disabled={isDisabled}
                    onChange={() => toggle(scope)}
                    style={{ accentColor: 'var(--accent-color)' }}
                  />
                  {labelText}
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
