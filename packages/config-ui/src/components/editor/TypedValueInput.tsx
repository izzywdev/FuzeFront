import { Input, Select, Toggle, CodeField } from '@fuzefront/design-system'
import type { KeyDefinition } from '@fuzefront/config-client'

export interface TypedValueInputProps {
  definition: KeyDefinition
  value: unknown
  disabled?: boolean
  error?: string
  onChange: (value: unknown) => void
  hooks?: Record<string, string | undefined>
}

/**
 * Renders the right control for `definition.valueType` — 01-settings-editor.html
 * `.entry-val`. Secret values never reach this component (they never carry
 * `value` at all — see `SecretField`).
 */
export function TypedValueInput({ definition, value, disabled, error, onChange, hooks }: TypedValueInputProps) {
  const common = { disabled, error, ...hooks }

  switch (definition.valueType) {
    case 'boolean':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Toggle
            checked={Boolean(value)}
            disabled={disabled}
            onChange={e => onChange(e.target.checked)}
            {...hooks}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-md)' }}>
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </span>
      )

    case 'enum':
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          options={(definition.enumValues ?? []).map(v => ({ value: String(v), label: String(v) }))}
          {...common}
        />
      )

    case 'number':
      return (
        <Input
          type="number"
          value={typeof value === 'number' ? value : (value as string | number | undefined) ?? ''}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          {...common}
        />
      )

    case 'json':
      return (
        <CodeField
          multiline
          value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
          onChange={e => onChange(e.target.value)}
          {...common}
        />
      )

    case 'duration':
    case 'color':
      return (
        <CodeField
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          {...common}
        />
      )

    case 'url':
      return (
        <Input
          type="url"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          {...common}
        />
      )

    case 'email':
      return (
        <Input
          type="email"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          {...common}
        />
      )

    case 'string':
    default:
      return (
        <Input
          type="text"
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          {...common}
        />
      )
  }
}
