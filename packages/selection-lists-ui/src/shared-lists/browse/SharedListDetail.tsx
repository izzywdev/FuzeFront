/**
 * SharedListDetail — the shared-lists aware list detail (flow `shared-read`).
 *
 * Mounted by the 4.0.0 detail ONLY while the release flag is ON (the 4.0.0
 * detail is untouched while it is OFF). It reads the list once (`useSharedList`,
 * 4.1.0 fields) and decides what to render from `editable`:
 *
 *  - loading     skeleton; no badge, notice or action waits-guesses "editable".
 *  - not found   "List not found" — 404, never a 403 / permission message (so a
 *                URL cannot probe whether a list exists).
 *  - `false`     the read-only detail (`ReadOnlyListDetail`).
 *  - `true`      the 4.0.0 editor, with the visibility / fork markers above it.
 *  - absent      the 4.0.0 editor, untouched: absence is UNKNOWN, never `false`.
 */

import type { MouseEvent, ReactNode } from 'react'
import { Button } from '@fuzefront/design-system'
import {
  editableStateOf,
  useSharedList,
  type SharedList,
} from '../core'
import { DETAIL_COPY } from './copy'
import { EditableHint } from './EditableHint'
import { ForkBadge } from './ForkBadge'
import { PanelSkeleton, PanelStateBlock } from './PanelState'
import { ReadOnlyListDetail } from './ReadOnlyListDetail'
import * as css from './styles'
import { VisibilityBadge } from './VisibilityBadge'

export interface SharedListDetailProps {
  listId: string
  /** The 4.0.0 editor, for a list the caller can (or may be able to) edit. */
  renderEditor: (context: { header: ReactNode | undefined; list: SharedList }) => ReactNode
  /** The fork flow's "Fork to edit…" button. */
  forkAction?: (list: SharedList) => ReactNode
  /**
   * Rendered above the READ-ONLY detail (the editor gets the same through its
   * `header`): the fork flow's arrival notice, so a fork the caller can read but
   * not edit still says what happened.
   */
  renderReadOnlyArrival?: (list: SharedList) => ReactNode
  hrefForList: (list: SharedList) => string
  onOpenList: (list: SharedList) => void
  onOpenTranslations: () => void
  onBackToIndex: () => void
  indexHref: string
}

function PanelFrame({
  state,
  children,
}: {
  state: 'loading' | 'error' | 'not-found'
  children: ReactNode
}) {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <section data-panel="value-table" data-state={state} style={css.panel}>
        {children}
      </section>
    </div>
  )
}

export function SharedListDetail({
  listId,
  renderEditor,
  forkAction,
  renderReadOnlyArrival,
  hrefForList,
  onOpenList,
  onOpenTranslations,
  onBackToIndex,
  indexHref,
}: SharedListDetailProps) {
  const state = useSharedList(listId)

  if (state.phase === 'loading') {
    return (
      <PanelFrame state="loading">
        <PanelSkeleton label={DETAIL_COPY.loadingLabel} />
      </PanelFrame>
    )
  }

  if (state.phase === 'not_found') {
    return (
      <PanelFrame state="not-found">
        <PanelStateBlock
          icon="∅"
          title={DETAIL_COPY.notFoundTitle}
          body={DETAIL_COPY.notFoundBody}
          bodyProps={{ 'data-error': 'NOT_FOUND' }}
          action={
            <Button
              as="a"
              href={indexHref}
              variant="secondary"
              size="sm"
              onClick={(event: MouseEvent) => {
                event.preventDefault()
                onBackToIndex()
              }}
            >
              {DETAIL_COPY.notFoundBack}
            </Button>
          }
        />
      </PanelFrame>
    )
  }

  if (state.phase === 'error') {
    return (
      <PanelFrame state="error">
        <PanelStateBlock
          icon="⚠"
          title={DETAIL_COPY.errorTitle}
          body={DETAIL_COPY.errorBody}
          role="alert"
          action={
            <Button variant="secondary" size="sm" data-action="retry" onClick={state.reload}>
              {DETAIL_COPY.retry}
            </Button>
          }
        />
      </PanelFrame>
    )
  }

  const { list } = state
  const editable = editableStateOf(list)

  if (editable === 'read-only') {
    const arrival = renderReadOnlyArrival?.(list)
    return (
      <>
        {/* inline padding only: an arrival that renders nothing adds no height */}
        {arrival ? <div style={{ paddingInline: 'var(--space-4)' }}>{arrival}</div> : null}
        <ReadOnlyListDetail
          list={list}
          forkAction={forkAction}
          hrefForList={hrefForList}
          onOpenList={onOpenList}
          onOpenTranslations={onOpenTranslations}
          onBackToIndex={onBackToIndex}
          indexHref={indexHref}
        />
      </>
    )
  }

  if (editable === 'editable') {
    return (
      <>
        {renderEditor({
          list,
          header: (
            <span style={{ ...css.metaRow, marginBlockEnd: 'var(--space-3)' }}>
              <VisibilityBadge list={list} variant="detail" />
              <ForkBadge list={list} />
              <EditableHint list={list} variant="detail" />
            </span>
          ),
        })}
      </>
    )
  }

  // `editable` absent: the 4.0.0 editor, as-is. Unknown is not read-only.
  return (
    <div data-panel="value-table" data-state="editable-unknown" data-editable-state="unknown">
      {renderEditor({ list, header: undefined })}
    </div>
  )
}
