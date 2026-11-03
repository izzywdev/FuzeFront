/**
 * SharedListIndexPanel — the list index with common lists (flow `shared-read`,
 * frame 01), mounted by the 4.0.0 index ONLY while the release flag is ON.
 *
 * ONE endpoint (`GET /v1/selection-lists`, the owning service's) — never two
 * services' answers joined in the browser. The controls are URL state, so a
 * reload or a shared link reproduces the view:
 *
 *   ?status=active|archived|all   (default active)
 *   ?include_shared=false         (absent = ON: the switch defaults ON)
 *   ?visibility=private|org|platform (only while the switch is ON; absent = Any)
 *
 * Request rules live in `useSharedListIndex` / `toListParams`: switch OFF sends
 * neither `include_shared` nor `visibility`; turning it OFF removes the
 * visibility filter (absent, not disabled) and resets it, and a filter choice is
 * never carried across the switch.
 *
 * The service paginates BEFORE it drops rows the caller cannot read, so a page
 * can be short, or empty with `hasMore` still true. "Empty" is therefore only
 * ever concluded from the LAST page: an empty page with more to come keeps
 * following the cursor.
 */

import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Select } from '@fuzefront/design-system'
import {
  useSharedListIndex,
  type SharedList,
  type StatusFilter,
  type VisibilityFilter as VisibilityFilterValue,
} from '../core'
import { INDEX_COPY } from './copy'
import { ListSourceGroups, ShadowNotes } from './ListSourceGroups'
import { PanelSkeleton, PanelStateBlock } from './PanelState'
import { SharedListsToggle } from './SharedListsToggle'
import { SharedReadStyles } from './SharedReadStyles'
import * as css from './styles'
import { VisibilityFilter } from './VisibilityFilter'

const STATUSES: readonly StatusFilter[] = ['active', 'archived', 'all']
const VISIBILITIES: readonly VisibilityFilterValue[] = ['private', 'org', 'platform']

export interface SharedListIndexPanelProps {
  hrefForList: (list: SharedList) => string
  onOpenList: (list: SharedList) => void
  onNewList: () => void
  /** Quota says the organization cannot create another list. */
  newListDisabled?: boolean
}

export function SharedListIndexPanel({
  hrefForList,
  onOpenList,
  onNewList,
  newListDisabled = false,
}: SharedListIndexPanelProps) {
  const [params, setParams] = useSearchParams()

  const rawStatus = params.get('status')
  const status: StatusFilter = STATUSES.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'active'
  const includeShared = params.get('include_shared') !== 'false'
  const rawVisibility = params.get('visibility')
  const visibility: VisibilityFilterValue =
    includeShared && VISIBILITIES.includes(rawVisibility as VisibilityFilterValue)
      ? (rawVisibility as VisibilityFilterValue)
      : 'any'

  const update = useCallback(
    (change: (next: URLSearchParams) => void) => {
      setParams(
        previous => {
          const next = new URLSearchParams(previous)
          change(next)
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  const index = useSharedListIndex({ status, includeShared, visibility })

  // An empty page with more to come is not "empty": follow the cursor.
  const draining =
    index.phase === 'ready' &&
    index.rows.length === 0 &&
    index.hasMore &&
    !index.loadMoreFailed
  const { loadMore } = index
  useEffect(() => {
    if (draining && !index.loadingMore) loadMore()
  }, [draining, index.loadingMore, loadMore])

  const failed =
    index.phase === 'error' ||
    (index.phase === 'ready' &&
      index.rows.length === 0 &&
      index.hasMore &&
      index.loadMoreFailed)
  const loading = index.phase === 'loading' || draining
  const showEmpty = index.isEmpty && !index.hasMore

  const setIncludeShared = (next: boolean) =>
    update(search => {
      if (next) search.delete('include_shared')
      else search.set('include_shared', 'false')
      search.delete('visibility')
    })
  const setVisibility = (next: VisibilityFilterValue) =>
    update(search => {
      if (next === 'any') search.delete('visibility')
      else search.set('visibility', next)
    })

  const panelState = failed
    ? 'error'
    : loading
      ? 'loading'
      : showEmpty
        ? includeShared
          ? visibility === 'any'
            ? 'empty'
            : 'empty-filtered'
          : 'empty-shared-off'
        : 'ready'

  return (
    <>
      <SharedReadStyles />
      <div
        data-toolbar="list-index"
        data-include-shared={includeShared ? 'true' : 'false'}
        style={css.toolbar}
      >
        <div style={{ minInlineSize: 'var(--space-24)' }}>
          <Select
            aria-label={INDEX_COPY.statusLabel}
            data-filter="status"
            value={status}
            onChange={event =>
              update(search => {
                if (event.target.value === 'active') search.delete('status')
                else search.set('status', event.target.value)
              })
            }
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        {includeShared && (
          <VisibilityFilter value={visibility} onChange={setVisibility} />
        )}
        <span style={css.grow} />
        <SharedListsToggle checked={includeShared} onChange={setIncludeShared} />
      </div>

      <section
        data-panel="list-index"
        data-state={panelState}
        data-include-shared={includeShared ? 'true' : 'false'}
        aria-busy={loading ? 'true' : undefined}
        style={css.panel}
      >
        {loading && <PanelSkeleton label="Loading lists" />}

        {failed && (
          <PanelStateBlock
            icon="⚠"
            title={INDEX_COPY.errorTitle}
            body={INDEX_COPY.errorBody}
            role="alert"
            action={
              <Button
                variant="secondary"
                size="sm"
                data-action="retry"
                onClick={index.phase === 'error' ? index.reload : index.loadMore}
              >
                {INDEX_COPY.retry}
              </Button>
            }
          />
        )}

        {panelState === 'empty' && (
          <PanelStateBlock
            icon="☰"
            title={INDEX_COPY.emptyTitle}
            body={INDEX_COPY.emptyBody}
            action={
              <Button
                variant="primary"
                size="sm"
                data-action="new-list"
                disabled={newListDisabled}
                onClick={onNewList}
              >
                {INDEX_COPY.emptyCta}
              </Button>
            }
          />
        )}

        {panelState === 'empty-filtered' && (
          <PanelStateBlock
            icon="☰"
            title={INDEX_COPY.emptyFilteredTitle}
            body={INDEX_COPY.emptyFilteredBody}
            action={
              <Button
                variant="secondary"
                size="sm"
                data-action="clear-visibility-filter"
                onClick={() => setVisibility('any')}
              >
                {INDEX_COPY.visibilityAny}
              </Button>
            }
          />
        )}

        {panelState === 'empty-shared-off' && (
          <PanelStateBlock
            icon="○"
            title={INDEX_COPY.emptySharedOffTitle}
            body={INDEX_COPY.emptySharedOffBody}
            action={
              <Button
                variant="secondary"
                size="sm"
                data-action="enable-include-shared"
                onClick={() => setIncludeShared(true)}
              >
                {INDEX_COPY.emptySharedOffCta}
              </Button>
            }
          />
        )}

        {panelState === 'ready' && (
          <>
            <ListSourceGroups
              rows={index.rows}
              groups={index.groups}
              hrefFor={hrefForList}
              onOpen={onOpenList}
            />
            <div style={css.panelFoot}>
              <span style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {index.groups && (
                  <ShadowNotes
                    rows={index.rows}
                    onShowCommon={() => setVisibility('platform')}
                  />
                )}
                {index.loadMoreFailed && (
                  <span role="alert" style={{ color: 'var(--error-color)' }}>
                    {INDEX_COPY.loadMoreFailed}
                  </span>
                )}
              </span>
              {index.hasMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-action="load-more"
                  disabled={index.loadingMore}
                  onClick={index.loadMore}
                >
                  {index.loadMoreFailed ? INDEX_COPY.retry : INDEX_COPY.loadMore}
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </>
  )
}
