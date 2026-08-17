import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pagination } from './Pagination'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'

function renderPager(props: Partial<ComponentProps<typeof Pagination>> = {}) {
  const onPageChange = vi.fn()
  render(
    <IdentityI18nProvider>
      <Pagination page={1} pageSize={25} total={100} onPageChange={onPageChange} {...props} />
    </IdentityI18nProvider>
  )
  return { onPageChange }
}

describe('Pagination', () => {
  it('renders nothing when the directory is empty', () => {
    render(
      <IdentityI18nProvider>
        <Pagination page={1} pageSize={25} total={0} onPageChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(document.querySelector('[data-panel="pagination"]')).not.toBeInTheDocument()
  })

  it('carries the pagination panel + action hooks', () => {
    renderPager()
    expect(document.querySelector('[data-panel="pagination"]')).toBeInTheDocument()
    expect(document.querySelector('[data-action="prev-page"]')).toBeInTheDocument()
    expect(document.querySelector('[data-action="next-page"]')).toBeInTheDocument()
  })

  it('disables Prev on the first page', () => {
    renderPager({ page: 1 })
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled()
  })

  it('disables Next on the last page (02-states.html b5 pager boundary)', () => {
    // total=100, pageSize=25 -> 4 pages
    renderPager({ page: 4 })
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled()
  })

  it('requests the next/previous page on click', () => {
    const { onPageChange } = renderPager({ page: 2 })
    screen.getByRole('button', { name: /^next$/i }).click()
    expect(onPageChange).toHaveBeenCalledWith(3)
    screen.getByRole('button', { name: /previous/i }).click()
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('shows the true server total in the pager info', () => {
    renderPager({ page: 1, pageSize: 25, total: 2481 })
    expect(document.querySelector('[data-pager-info]')).toHaveTextContent('2481')
  })
})
