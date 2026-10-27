/**
 * ListTabs — Values · Translations for a list the caller can only read
 * (frames 02, 03). There is NO Access tab: `GET …/access` needs
 * `manage_access`, so a reader cannot see a roster (rendering the tab would be
 * rendering-and-403). Built on the design system's accessible tab strip.
 */

import { Tabs } from '@fuzefront/design-system'
import { DETAIL_COPY } from './copy'

export type ReadOnlyTab = 'values' | 'translations'

export interface ListTabsProps {
  active: ReadOnlyTab
  onSelect: (tab: ReadOnlyTab) => void
}

export function ListTabs({ active, onSelect }: ListTabsProps) {
  return (
    <Tabs
      ariaLabel={DETAIL_COPY.tabsLabel}
      data-tabs="list-detail"
      value={active}
      onChange={value => {
        if (value !== active) onSelect(value as ReadOnlyTab)
      }}
      tabs={[
        { value: 'values', label: DETAIL_COPY.tabValues },
        { value: 'translations', label: DETAIL_COPY.tabTranslations },
      ]}
      style={{ marginBlockEnd: 'var(--space-4)' }}
    />
  )
}
