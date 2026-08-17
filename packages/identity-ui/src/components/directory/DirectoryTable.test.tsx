import type { ComponentProps } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DirectoryTable } from './DirectoryTable'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { DirectoryMember } from '../../api/directoryClient'

const members: DirectoryMember[] = [
  { userId: 'usr_1001', displayName: 'Ada Rowe', email: 'ada@ex.com', role: 'owner', isSelf: true },
  { userId: 'usr_1002', displayName: 'Jae Moon', email: 'jae@ex.com', role: 'admin' },
]

function renderTable(props: Partial<ComponentProps<typeof DirectoryTable>> = {}) {
  return render(
    <IdentityI18nProvider>
      <DirectoryTable members={members} emptyState={<div>empty!</div>} {...props} />
    </IdentityI18nProvider>
  )
}

describe('DirectoryTable', () => {
  it('carries the member-directory / directory list hooks', () => {
    renderTable()
    expect(document.querySelector('[data-panel="member-directory"][data-list="directory"]')).toBeInTheDocument()
  })

  it('renders one row per member', () => {
    renderTable()
    expect(document.querySelector('[data-user="usr_1001"]')).toBeInTheDocument()
    expect(document.querySelector('[data-user="usr_1002"]')).toBeInTheDocument()
  })

  it('shows the caller-supplied empty state when there are no members', () => {
    renderTable({ members: [] })
    expect(screen.getByText('empty!')).toBeInTheDocument()
  })

  it('shows loading skeleton rows instead of the empty state while loading', () => {
    renderTable({ members: [], loading: true })
    expect(screen.queryByText('empty!')).not.toBeInTheDocument()
  })
})
