import type { ChangeEvent } from 'react'
import { SearchField } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface DirectorySearchBarProps {
  value: string
  onChange: (value: string) => void
}

/**
 * Server-side directory search box — `data-input="directory-search"`
 * (01-directory.html). The client never fetches the full directory to
 * filter locally (gate-pagination); every keystroke ultimately becomes a
 * `query` param on the directory request, debounced by {@link MemberDirectoryFlow}.
 */
export function DirectorySearchBar({ value, onChange }: DirectorySearchBarProps) {
  const { messages } = useIdentityI18n()
  const m = messages.directory
  return (
    <SearchField
      label={m.searchLabel}
      placeholder={m.searchPlaceholder}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      data-input="directory-search"
    />
  )
}
