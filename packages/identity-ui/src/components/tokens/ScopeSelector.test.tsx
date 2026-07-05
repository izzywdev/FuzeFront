import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScopeSelector } from './ScopeSelector'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

function renderSel(props: Partial<React.ComponentProps<typeof ScopeSelector>> = {}) {
  const onChange = vi.fn()
  render(
    <IdentityI18nProvider>
      <ScopeSelector value={[]} onChange={onChange} {...props} />
    </IdentityI18nProvider>
  )
  return { onChange }
}

describe('ScopeSelector', () => {
  it('renders grouped scope checkboxes with human labels', () => {
    renderSel()
    expect(screen.getByLabelText('Read apps')).toBeInTheDocument()
    expect(screen.getByLabelText('Invite members')).toBeInTheDocument()
    // group headings
    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(screen.getByText('User Management')).toBeInTheDocument()
  })

  it('emits the updated scope array when a scope is toggled on', () => {
    const { onChange } = renderSel()
    fireEvent.click(screen.getByLabelText('Read apps'))
    expect(onChange).toHaveBeenCalledWith(['App:read'])
  })

  it('removes a scope when toggled off', () => {
    const { onChange } = renderSel({ value: ['App:read', 'App:install'] })
    fireEvent.click(screen.getByLabelText('Read apps'))
    expect(onChange).toHaveBeenCalledWith(['App:install'])
  })

  it('disables scopes not in availableScopes', () => {
    renderSel({ availableScopes: ['App:read'] })
    expect(screen.getByLabelText('Read apps')).not.toBeDisabled()
    expect(screen.getByLabelText('Delete apps')).toBeDisabled()
  })
})
