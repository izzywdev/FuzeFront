import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DirectorySearchBar } from './DirectorySearchBar'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

describe('DirectorySearchBar', () => {
  it('renders the directory-search input hook', () => {
    render(
      <IdentityI18nProvider>
        <DirectorySearchBar value="" onChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(document.querySelector('[data-input="directory-search"]')).toBeInTheDocument()
  })

  it('calls onChange with the new value as the caller types', () => {
    const onChange = vi.fn()
    render(
      <IdentityI18nProvider>
        <DirectorySearchBar value="" onChange={onChange} />
      </IdentityI18nProvider>
    )
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ada' } })
    expect(onChange).toHaveBeenCalledWith('ada')
  })
})
