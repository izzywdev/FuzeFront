import type { ComponentProps } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemberDirectoryFlow } from './MemberDirectoryFlow'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { DirectoryMember } from '../../api/directoryClient'

const members: DirectoryMember[] = [
  { userId: 'usr_1001', displayName: 'Ada Rowe', email: 'ada@ex.com', role: 'owner', isSelf: true },
  { userId: 'usr_1002', displayName: 'Jae Moon', email: 'jae@ex.com', role: 'admin' },
]

function renderFlow(props: Partial<ComponentProps<typeof MemberDirectoryFlow>> = {}) {
  const onQueryChange = vi.fn()
  const onPageChange = vi.fn()
  const onRetry = vi.fn()
  const utils = render(
    <IdentityI18nProvider>
      <MemberDirectoryFlow
        members={members}
        page={1}
        pageSize={25}
        total={2}
        query=""
        onQueryChange={onQueryChange}
        onPageChange={onPageChange}
        onRetry={onRetry}
        {...props}
      />
    </IdentityI18nProvider>
  )
  return { ...utils, onQueryChange, onPageChange, onRetry }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MemberDirectoryFlow', () => {
  it('exposes the current UI state via data-state="populated" when members are loaded', () => {
    renderFlow()
    expect(document.querySelector('[data-panel="member-directory-flow"]')).toHaveAttribute('data-state', 'populated')
  })

  it('marks aria-busy and data-state="loading" while loading (02-states.html b1)', () => {
    renderFlow({ loading: true, members: [], total: 0 })
    const panel = document.querySelector('[data-panel="member-directory-flow"]')
    expect(panel).toHaveAttribute('data-state', 'loading')
    expect(panel).toHaveAttribute('aria-busy', 'true')
  })

  it('renders DirectoryForbiddenNotice and nothing else for a 403 (02-states.html b6)', () => {
    renderFlow({ forbidden: true, members: [], total: 0 })
    const panel = document.querySelector('[data-panel="member-directory-flow"]')
    expect(panel).toHaveAttribute('data-state', 'forbidden')
    expect(document.querySelector('[data-http="403"][data-error-code="FORBIDDEN"]')).toBeInTheDocument()
    expect(document.querySelector('[data-panel="member-directory"]')).not.toBeInTheDocument()
  })

  it('renders the error state with a retry action wired to onRetry (02-states.html b4)', () => {
    const { onRetry } = renderFlow({ error: 'boom', members: [], total: 0 })
    const panel = document.querySelector('[data-panel="member-directory-flow"]')
    expect(panel).toHaveAttribute('data-state', 'error')
    const retry = document.querySelector('[data-action="retry"]') as HTMLButtonElement
    expect(retry).toBeInTheDocument()
    retry.click()
    expect(onRetry).toHaveBeenCalled()
  })

  it('debounces search keystrokes before calling onQueryChange (~300ms)', () => {
    vi.useFakeTimers()
    const { onQueryChange } = renderFlow()
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'a' } })
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ad' } })
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ada' } })
    expect(onQueryChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(onQueryChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange).toHaveBeenCalledWith('ada')
  })

  it('fires onQueryChange("") immediately from "Clear search" — no debounce wait', () => {
    vi.useFakeTimers()
    const { onQueryChange } = renderFlow({ members: [], total: 0, query: 'zzxq' })
    const clear = document.querySelector('[data-action="clear-search"]') as HTMLButtonElement
    act(() => {
      clear.click()
    })
    expect(onQueryChange).toHaveBeenCalledWith('')
  })

  it('shows no-results (distinct from empty) when total is 0 with an active query', () => {
    renderFlow({ members: [], total: 0, query: 'zzxq' })
    expect(document.querySelector('[data-panel="member-directory-flow"]')).toHaveAttribute('data-state', 'no-results')
    expect(screen.getByText(/no members match/i)).toBeInTheDocument()
  })

  it('shows the real empty state when total is 0 with no query', () => {
    renderFlow({ members: [], total: 0, query: '' })
    expect(document.querySelector('[data-panel="member-directory-flow"]')).toHaveAttribute('data-state', 'empty')
    expect(screen.getByText(/just you, for now/i)).toBeInTheDocument()
  })

  it('interpolates the org name into the subtitle when provided', () => {
    renderFlow({ orgName: 'FuzeFront' })
    expect(screen.getByText(/FuzeFront/)).toBeInTheDocument()
  })
})
