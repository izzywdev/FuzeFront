/**
 * ListSourceGroups — the index table, with its rows grouped client-side by
 * source (frame 01): "Your organization" and "Common lists" (`visibility =
 * platform`). The service paginates and filters; this component only arranges
 * the rows it was given and never re-adds a row the service left out (a common
 * list shadowed by the organization's own fork is simply not in the response).
 *
 * `groups = null` renders the same table flat — the visibility-filtered view
 * ("the filter already is the group"), the switch-OFF view and the flag-OFF
 * guard are all that one table without group rows.
 *
 * `ShadowNotes` renders, for each loaded fork row, a SOURCE-NEUTRAL note: the
 * response carries no source-existence metadata, so a fork whose common source
 * was purged looks exactly like one shadowing a live common list. The copy
 * therefore never says a common list is "hidden" or "replaced".
 */

import type { MouseEvent, ReactNode } from 'react'
import {
  forkedKeysOf,
  isCommonList,
  type ListGroups,
  type ListSourceGroup,
  type SharedList,
} from '../core'
import { GROUP_COPY, INDEX_COPY } from './copy'
import { EditableHint } from './EditableHint'
import { ForkBadge } from './ForkBadge'
import * as css from './styles'
import { VisibilityBadge } from './VisibilityBadge'

export interface ListSourceGroupsProps {
  /** Rows in service order (used when `groups` is null). */
  rows: readonly SharedList[]
  /** Source groups; `null` = no grouping for this query. */
  groups: ListGroups | null
  /** Where a row's name links to (a real anchor, so open-in-new-tab works). */
  hrefFor: (list: SharedList) => string
  /** Plain left-click on a row's name. */
  onOpen: (list: SharedList) => void
}

const GROUP_ORDER: readonly ListSourceGroup[] = ['own', 'common']

function openOnPlainClick(
  event: MouseEvent<HTMLAnchorElement>,
  open: () => void
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return
  event.preventDefault()
  open()
}

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(when)
}

function ListRow({
  list,
  hrefFor,
  onOpen,
}: {
  list: SharedList
  hrefFor: (list: SharedList) => string
  onOpen: (list: SharedList) => void
}) {
  const common = isCommonList(list)
  return (
    <tr
      data-list={list.key}
      data-source={common ? 'platform' : 'own'}
      data-status={list.status}
      data-machine={list.is_machine ? 'true' : undefined}
      style={{ opacity: list.status === 'archived' ? 0.7 : 1 }}
    >
      <td style={css.tdName}>
        <a
          className="fz-sl-link"
          href={hrefFor(list)}
          onClick={event => openOnPlainClick(event, () => onOpen(list))}
          style={{ color: 'inherit' }}
        >
          {list.name}
        </a>
        {list.is_machine && (
          <span data-machine="true" style={{ marginInlineStart: 'var(--space-2)' }}>
            {INDEX_COPY.machine}
          </span>
        )}
        {list.status === 'archived' && (
          <span
            data-status="archived"
            style={{ ...css.mutedText, marginInlineStart: 'var(--space-2)' }}
          >
            {INDEX_COPY.archived}
          </span>
        )}
      </td>
      <td className="fz-sl-hide-sm" style={css.td}>
        <span style={css.keyChip}>{list.key}</span>
      </td>
      <td style={css.td}>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <VisibilityBadge list={list} />
          <ForkBadge list={list} />
        </span>
      </td>
      <td style={css.td}>
        <EditableHint list={list} />
      </td>
      <td className="fz-sl-hide-sm" style={{ ...css.td, ...css.numeric }}>
        {list.item_count}
      </td>
      <td className="fz-sl-hide-sm" style={{ ...css.td, ...css.mutedText }}>
        {formatDate(list.updated_at)}
      </td>
    </tr>
  )
}

function GroupRow({
  group,
  loaded,
}: {
  group: ListSourceGroup
  loaded: number
}) {
  const copy = GROUP_COPY[group]
  return (
    <tr data-group={group}>
      <th scope="rowgroup" colSpan={6} style={css.groupRow}>
        <b style={{ color: 'var(--text-secondary)', fontWeight: 'var(--weight-medium)' }}>
          {copy.title}
        </b>
        {copy.detail ? ` · ${copy.detail}` : ''} · {loaded} loaded
      </th>
    </tr>
  )
}

export function ListSourceGroups({
  rows,
  groups,
  hrefFor,
  onOpen,
}: ListSourceGroupsProps) {
  const columns = INDEX_COPY.columns
  const body: ReactNode = groups
    ? GROUP_ORDER.flatMap(group =>
        // A header only ever precedes at least one row: no empty "Common lists" header.
        groups[group].length === 0
          ? []
          : [
              <GroupRow key={`group-${group}`} group={group} loaded={groups[group].length} />,
              ...groups[group].map(list => (
                <ListRow key={list.id} list={list} hrefFor={hrefFor} onOpen={onOpen} />
              )),
            ]
      )
    : rows.map(list => (
        <ListRow key={list.id} list={list} hrefFor={hrefFor} onOpen={onOpen} />
      ))

  return (
    <div className="fz-sl-scroll">
      <table className="fz-sl-table" style={css.table}>
        <thead>
          <tr>
            <th scope="col" style={css.th}>{columns.name}</th>
            <th scope="col" className="fz-sl-hide-sm" style={css.th}>{columns.key}</th>
            <th scope="col" style={css.th}>{columns.visibility}</th>
            <th scope="col" style={css.th}>{columns.access}</th>
            <th scope="col" className="fz-sl-hide-sm" style={{ ...css.th, textAlign: 'end' }}>
              {columns.values}
            </th>
            <th scope="col" className="fz-sl-hide-sm" style={css.th}>{columns.updated}</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  )
}

export interface ShadowNotesProps {
  rows: readonly SharedList[]
  /** "Show common lists only" — sets the visibility filter to Common (shadowing off). */
  onShowCommon: () => void
}

/** One source-neutral note per loaded fork key (frame 01, panel foot). */
export function ShadowNotes({ rows, onShowCommon }: ShadowNotesProps) {
  const keys = forkedKeysOf(rows)
  if (keys.length === 0) return null
  return (
    <>
      {keys.map(key => (
        <span
          key={key}
          data-shadow-note={key}
          style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1)' }}
        >
          <span aria-hidden="true">⑂</span>
          <span style={css.keyChip}>{key}</span>
          {" is your organization's fork; a common list with the same key is not listed here."}
          <button
            type="button"
            data-action="show-shadowed"
            className="fz-sl-link"
            onClick={onShowCommon}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {INDEX_COPY.showCommonOnly}
          </button>
        </span>
      ))}
    </>
  )
}
