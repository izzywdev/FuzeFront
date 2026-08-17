import type { ReactNode } from 'react'
import { DataTable } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { DirectoryRow } from './DirectoryRow'
import type { DirectoryMember } from '../../api/directoryClient'

export interface DirectoryTableProps {
  members: DirectoryMember[]
  loading?: boolean
  /** Rendered when `members` is empty and not loading — swaps between the real empty and no-results states. */
  emptyState: ReactNode
}

/**
 * Directory grid — `data-panel="member-directory"` / `data-list="directory"`
 * (01-directory.html testHooks). Loading renders the DS skeleton rows
 * (`aria-busy` via DataTable); an empty result set defers entirely to the
 * caller-supplied `emptyState` (real empty vs no-search-results, 02-states.html).
 */
export function DirectoryTable({ members, loading, emptyState }: DirectoryTableProps) {
  const { messages } = useIdentityI18n()
  const m = messages.directory

  const columns = [
    { key: 'person', header: m.person },
    { key: 'email', header: m.email },
    { key: 'joined', header: m.joined },
    { key: 'role', header: m.role },
  ]

  return (
    <DataTable
      columns={columns}
      loading={loading}
      emptyState={emptyState}
      data-panel="member-directory"
      data-list="directory"
      aria-busy={loading ? 'true' : undefined}
    >
      {members.length > 0 && (
        <tbody>
          {members.map((member) => (
            <DirectoryRow key={member.userId} member={member} />
          ))}
        </tbody>
      )}
    </DataTable>
  )
}
