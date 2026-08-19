import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoResultsState } from './NoResultsState'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

describe('NoResultsState', () => {
  it('renders a no-results message naming the query (distinct from empty)', () => {
    render(
      <IdentityI18nProvider>
        <NoResultsState query="zzxq" onClear={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(screen.getByText(/no members match/i)).toHaveTextContent('zzxq')
  })

  it('carries the clear-search action hook and calls onClear', () => {
    const onClear = vi.fn()
    render(
      <IdentityI18nProvider>
        <NoResultsState query="zzxq" onClear={onClear} />
      </IdentityI18nProvider>
    )
    const btn = document.querySelector('[data-action="clear-search"]') as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(onClear).toHaveBeenCalled()
  })
})
