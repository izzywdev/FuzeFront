import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DirectoryEmptyState } from './DirectoryEmptyState'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

describe('DirectoryEmptyState', () => {
  it('renders the real-empty copy (02-states.html b2) — a fresh install has one member', () => {
    render(
      <IdentityI18nProvider>
        <DirectoryEmptyState />
      </IdentityI18nProvider>
    )
    expect(screen.getByText(/just you, for now/i)).toBeInTheDocument()
  })
})
