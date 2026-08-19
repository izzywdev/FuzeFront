import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { RolesPermissionsPanel } from './RolesPermissionsPanel'
import { IdentityI18nProvider } from '../../i18n/IdentityI18nProvider'
import type { RolesCatalog } from '../../types'

const catalog: RolesCatalog = {
  roles: [
    { key: 'owner', name: 'Owner', assignable: false, permissions: ['Organization:manage', 'UserManagement:invite'] },
    { key: 'admin', name: 'Admin', assignable: true, permissions: ['Organization:manage', 'UserManagement:invite'] },
    { key: 'viewer', name: 'Viewer', assignable: true, permissions: ['Organization:read'] },
  ],
  resources: [
    { key: 'Organization', name: 'Organization', actions: [{ key: 'read', name: 'Read' }, { key: 'manage', name: 'Manage' }] },
    { key: 'UserManagement', name: 'User Management', actions: [{ key: 'invite', name: 'Invite' }] },
  ],
}

function renderPanel(props: Partial<React.ComponentProps<typeof RolesPermissionsPanel>> = {}, locale: 'en' | 'he' = 'en') {
  return render(
    <IdentityI18nProvider locale={locale}>
      <RolesPermissionsPanel catalog={catalog} {...props} />
    </IdentityI18nProvider>
  )
}

describe('RolesPermissionsPanel', () => {
  it('renders an accessible table with a column header per role', () => {
    renderPanel()
    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    const colHeaders = within(table).getAllByRole('columnheader')
    // permission column + 3 roles
    expect(colHeaders).toHaveLength(4)
  })

  it('renders a row header per resource:action permission', () => {
    renderPanel()
    // 2 + 1 = 3 permission rows → 3 row headers
    const rowHeaders = screen.getAllByRole('rowheader')
    expect(rowHeaders).toHaveLength(3)
    expect(screen.getByText('Manage')).toBeInTheDocument()
    expect(screen.getByText('Invite')).toBeInTheDocument()
  })

  it('marks granted vs not-granted cells with accessible labels', () => {
    renderPanel()
    // admin grants Organization:manage
    expect(screen.getAllByLabelText('Granted for Admin').length).toBeGreaterThan(0)
    // viewer does not grant Organization:manage
    expect(screen.getAllByLabelText('Not granted for Viewer').length).toBeGreaterThan(0)
  })

  it('shows the error state with a retry action', () => {
    const onRetry = vi.fn()
    renderPanel({ catalog: null, error: 'boom', onRetry })
    expect(screen.getByText('Could not load permissions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('shows a loading status before the catalog arrives', () => {
    renderPanel({ catalog: null, loading: true })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the empty state when there are no roles', () => {
    renderPanel({ catalog: { roles: [], resources: [] } })
    expect(screen.getByText('No roles defined')).toBeInTheDocument()
  })

  it('renders Hebrew (RTL) strings under the he locale', () => {
    renderPanel({}, 'he')
    expect(screen.getByText('הרשאות')).toBeInTheDocument()
    expect(screen.getByText('מה כל תפקיד מעניק בארגון הזה.')).toBeInTheDocument()
  })
})
