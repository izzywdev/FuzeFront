import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MembersTable } from './MembersTable'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { Member } from '../../types'

const members: Member[] = [
  { id: 'm1', role: 'owner', status: 'active', user: { id: 'u1', email: 'owner@ex.com', firstName: 'Ann', lastName: 'Zephyr' }, joined_at: '2025-01-01T00:00:00Z' },
  { id: 'm2', role: 'member', status: 'active', user: { id: 'u2', email: 'bob@ex.com', firstName: 'Bob', lastName: 'Adams' }, joined_at: '2025-02-01T00:00:00Z' },
]

function renderTable(props: Partial<React.ComponentProps<typeof MembersTable>> = {}) {
  const onRoleChange = vi.fn().mockResolvedValue(undefined)
  const onRemove = vi.fn().mockResolvedValue(undefined)
  render(
    <IdentityI18nProvider>
      <MembersTable
        organizationId="org-1"
        members={members}
        userRole="owner"
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        {...props}
      />
    </IdentityI18nProvider>
  )
  return { onRoleChange, onRemove }
}

describe('MembersTable', () => {
  it('renders a row per member with email', () => {
    renderTable()
    expect(screen.getByText('owner@ex.com')).toBeInTheDocument()
    expect(screen.getByText('bob@ex.com')).toBeInTheDocument()
  })

  it('shows the empty state when there are no members', () => {
    renderTable({ members: [] })
    expect(screen.getByText('No members yet')).toBeInTheDocument()
  })

  it('shows the loading skeleton when loading', () => {
    renderTable({ members: [], loading: true })
    // DataTable renders a thead even while loading; no empty-state text.
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
  })

  it('hides the remove control when the caller is a viewer', () => {
    renderTable({ userRole: 'viewer' })
    expect(screen.queryByRole('button', { name: /remove bob/i })).not.toBeInTheDocument()
  })

  it('calls onRoleChange when a role is changed', async () => {
    const { onRoleChange } = renderTable()
    const selects = screen.getAllByRole('combobox')
    // second member (bob) is a member; change to viewer
    fireEvent.change(selects[selects.length - 1], { target: { value: 'viewer' } })
    await waitFor(() => expect(onRoleChange).toHaveBeenCalledWith('m2', 'viewer'))
  })

  it('does not render a pager when no pagination is provided', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
  })

  it('disables Previous on the first page and advances on Next', () => {
    const onPageChange = vi.fn()
    renderTable({ pagination: { page: 1, pageSize: 20, total: 41 }, onPageChange })
    const prev = screen.getByRole('button', { name: /previous/i })
    const next = screen.getByRole('button', { name: /next/i })
    expect(prev).toBeDisabled()
    expect(next).not.toBeDisabled()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    fireEvent.click(next)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('disables Next on the last page and goes back on Previous', () => {
    const onPageChange = vi.fn()
    renderTable({ pagination: { page: 3, pageSize: 20, total: 41 }, onPageChange })
    const prev = screen.getByRole('button', { name: /previous/i })
    const next = screen.getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()
    expect(prev).not.toBeDisabled()
    fireEvent.click(prev)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
