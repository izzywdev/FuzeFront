import React, { useMemo, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { DataTable, Avatar, RoleBadge, StatusPill, IconButton } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { EmptyState } from '../common/EmptyState'
import { RoleSelect } from './RoleSelect'
import { formatDate } from '../common/dates'
import type { Member, OrgRole } from '../../types'

export interface MembersTableProps {
  organizationId: string
  members: Member[]
  loading?: boolean
  error?: string | null
  userRole: OrgRole
  onRoleChange: (memberId: string, role: OrgRole) => Promise<void>
  onRemove: (memberId: string) => Promise<void>
  onInvite?: () => void
  onRetry?: () => void
}

const columnHelper = createColumnHelper<Member>()

const STATUS_PILL: Record<Member['status'], 'online' | 'degraded' | 'offline'> = {
  active: 'online',
  pending: 'degraded',
  suspended: 'offline',
}

function displayName(m: Member): string {
  const { firstName, lastName, email } = m.user
  const full = `${firstName ?? ''} ${lastName ?? ''}`.trim()
  return full || email
}

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.5 9h7l.5-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Sortable members grid backed by TanStack Table v8, rendered through the
 * design-system DataTable shell. Role assignment and removal are permission-gated.
 */
export function MembersTable({
  members,
  loading,
  error,
  userRole,
  onRoleChange,
  onRemove,
  onInvite,
  onRetry,
}: MembersTableProps) {
  const { messages, locale } = useIdentityI18n()
  const m = messages.members
  const [sorting, setSorting] = useState<SortingState>([])
  const canManage = userRole === 'owner' || userRole === 'admin'

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => `${row.user.lastName ?? ''} ${row.user.firstName ?? ''}`, {
        id: 'name',
        header: m.title,
        cell: (info) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Avatar name={displayName(info.row.original)} size="sm" />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
              {displayName(info.row.original)}
            </span>
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.user.email, {
        id: 'email',
        header: m.email,
        cell: (info) => (
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('role', {
        id: 'role',
        header: m.role,
        cell: (info) => {
          const member = info.row.original
          if (canManage && member.role !== 'owner') {
            return (
              <RoleSelect
                value={member.role}
                callerRole={userRole}
                onChange={(role) => onRoleChange(member.id, role)}
              />
            )
          }
          return <RoleBadge role={member.role} />
        },
      }),
      columnHelper.accessor('status', {
        id: 'status',
        header: m.status,
        enableSorting: false,
        cell: (info) => <StatusPill status={STATUS_PILL[info.getValue()]} label={m[`status${cap(info.getValue())}` as 'statusActive']} />,
      }),
      columnHelper.accessor((row) => row.joined_at ?? '', {
        id: 'joined',
        header: m.joined,
        cell: (info) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
            {formatDate(info.getValue() || null, locale) ?? '—'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: messages.common.actions,
        cell: (info) => {
          const member = info.row.original
          if (!canManage || member.role === 'owner') return null
          return (
            <IconButton label={`${m.remove} ${displayName(member)}`} size="sm" onClick={() => onRemove(member.id)}>
              <TrashIcon />
            </IconButton>
          )
        },
      }),
    ],
    [canManage, userRole, locale, m, messages.common.actions, onRoleChange, onRemove]
  )

  const table = useReactTable({
    data: members,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (error) {
    return <EmptyState variant="error" title={m.errorTitle} message={error} actionLabel={messages.common.retry} onAction={onRetry} />
  }

  const sortState = sorting[0]
  const dsColumns = table.getHeaderGroups()[0].headers.map((h) => ({
    key: h.column.id,
    header: flexRender(h.column.columnDef.header, h.getContext()),
    sortable: h.column.getCanSort(),
    align: h.column.id === 'actions' ? ('right' as const) : ('left' as const),
  }))

  const cellStyle: React.CSSProperties = {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
  }

  return (
    <DataTable
      columns={dsColumns}
      loading={loading}
      sortBy={sortState?.id}
      sortDir={sortState?.desc ? 'desc' : 'asc'}
      onSort={(key) => {
        const col = table.getColumn(key)
        col?.toggleSorting()
      }}
      emptyState={
        <EmptyState
          variant="empty-members"
          title={m.emptyTitle}
          message={m.emptyBody}
          actionLabel={canManage ? m.invite : undefined}
          onAction={canManage ? onInvite : undefined}
        />
      }
    >
      {members.length > 0 && (
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} style={{ ...cellStyle, textAlign: cell.column.id === 'actions' ? 'right' : 'left' }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </DataTable>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
