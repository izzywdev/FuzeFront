/**
 * ReadOnlyListShell — the page chrome of a list the caller can only read
 * (frames 02, 03, 11): breadcrumb, title, the single primary action, the
 * key / visibility / access row, then the tab strip.
 *
 * Direction comes from the host's `dir` (set from the locale on the page root):
 * layout here uses logical properties only, so nothing is re-specified for RTL,
 * and keys and ids are bidi-isolated LTR islands. At <= 40em the primary
 * action goes full-width above the notice.
 */

import type { ReactNode } from 'react'
import type { SharedList } from '../core'
import { DETAIL_COPY } from './copy'
import { EditableHint } from './EditableHint'
import { ForkBadge } from './ForkBadge'
import { ListTabs, type ReadOnlyTab } from './ListTabs'
import { SharedReadStyles } from './SharedReadStyles'
import * as css from './styles'
import { VisibilityBadge } from './VisibilityBadge'

export interface ReadOnlyListShellProps {
  list: SharedList
  activeTab: ReadOnlyTab
  /** The primary action (the fork flow's "Fork to edit…"), when one applies. */
  actions?: ReactNode
  /** The notice, facts or anything that sits between the meta row and the tabs. */
  intro?: ReactNode
  onSelectTab: (tab: ReadOnlyTab) => void
  /** Plain click on the breadcrumb root. */
  onBackToIndex: () => void
  indexHref: string
  children: ReactNode
}

export function ReadOnlyListShell({
  list,
  activeTab,
  actions,
  intro,
  onSelectTab,
  onBackToIndex,
  indexHref,
  children,
}: ReadOnlyListShellProps) {
  return (
    <div data-list-detail={list.key} style={{ padding: 'var(--space-4)' }}>
      <SharedReadStyles />
      <nav aria-label="Breadcrumb" style={{ ...css.mutedText, marginBlockEnd: 'var(--space-2)' }}>
        <a
          className="fz-sl-link"
          href={indexHref}
          onClick={event => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
              event.preventDefault()
              onBackToIndex()
            }
          }}
        >
          {DETAIL_COPY.breadcrumbRoot}
        </a>{' '}
        · <span>{list.name}</span>
      </nav>
      <div
        className="fz-sl-head"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          marginBlockEnd: 'var(--space-3)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--text-2xl)',
            color: 'var(--text-primary)',
          }}
        >
          {list.name}
        </h1>
        {actions && <div className="fz-sl-cta">{actions}</div>}
      </div>
      <div style={css.metaRow}>
        <span style={css.keyChip}>{list.key}</span>
        <VisibilityBadge list={list} variant="detail" />
        <ForkBadge list={list} />
        <EditableHint list={list} variant="detail" />
        <span className="fz-sl-hide-sm" style={css.mono}>
          {list.id}
        </span>
      </div>
      {intro}
      <ListTabs active={activeTab} onSelect={onSelectTab} />
      {children}
    </div>
  )
}
