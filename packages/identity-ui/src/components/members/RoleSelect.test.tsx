import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoleSelect } from './RoleSelect'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

function renderSelect(props: Partial<React.ComponentProps<typeof RoleSelect>> = {}) {
  const onChange = vi.fn()
  render(
    <IdentityI18nProvider>
      <RoleSelect value="member" callerRole="owner" onChange={onChange} {...props} />
    </IdentityI18nProvider>
  )
  return { onChange }
}

describe('RoleSelect', () => {
  it('renders assignable roles with localized labels', () => {
    renderSelect()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toContain('Admin')
    expect(labels).toContain('Member')
    expect(labels).toContain('Viewer')
  })

  it('emits the new role on change', () => {
    const { onChange } = renderSelect()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'viewer' } })
    expect(onChange).toHaveBeenCalledWith('viewer')
  })

  it('is disabled when the caller is a viewer', () => {
    renderSelect({ callerRole: 'viewer' })
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('is disabled when the target member is an owner', () => {
    renderSelect({ value: 'owner' })
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('respects an explicit disabled prop', () => {
    renderSelect({ disabled: true })
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
