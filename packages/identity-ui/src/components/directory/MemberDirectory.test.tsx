import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemberDirectory } from './MemberDirectory'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { DirectoryMember } from '../../api/directoryClient'

const members: DirectoryMember[] = [
  { userId: 'usr_1001', displayName: 'Ada Rowe', email: 'ada@ex.com', role: 'owner', isSelf: true },
]

describe('MemberDirectory', () => {
  it('shows the true server total (data-count="total")', () => {
    render(
      <IdentityI18nProvider>
        <MemberDirectory members={members} page={1} pageSize={25} total={2481} query="" onQueryChange={vi.fn()} onPageChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(document.querySelector('[data-count="total"]')).toHaveTextContent('2481')
  })

  it('shows the real empty state when total is 0 and there is no active search', () => {
    render(
      <IdentityI18nProvider>
        <MemberDirectory members={[]} page={1} pageSize={25} total={0} query="" onQueryChange={vi.fn()} onPageChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(screen.getByText(/just you, for now/i)).toBeInTheDocument()
  })

  it('shows the no-results state when total is 0 with an active search — distinct from empty', () => {
    render(
      <IdentityI18nProvider>
        <MemberDirectory members={[]} page={1} pageSize={25} total={0} query="zzxq" onQueryChange={vi.fn()} onPageChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(screen.getByText(/no members match/i)).toBeInTheDocument()
    expect(screen.queryByText(/just you, for now/i)).not.toBeInTheDocument()
  })

  it('propagates search input to onQueryChange', () => {
    const onQueryChange = vi.fn()
    render(
      <IdentityI18nProvider>
        <MemberDirectory members={members} page={1} pageSize={25} total={1} query="" onQueryChange={onQueryChange} onPageChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ada' } })
    expect(onQueryChange).toHaveBeenCalledWith('ada')
  })

  it('renders the pager for a populated page', () => {
    render(
      <IdentityI18nProvider>
        <MemberDirectory members={members} page={1} pageSize={25} total={100} query="" onQueryChange={vi.fn()} onPageChange={vi.fn()} />
      </IdentityI18nProvider>
    )
    expect(document.querySelector('[data-panel="pagination"]')).toBeInTheDocument()
  })
})
