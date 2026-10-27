/**
 * ReadOnlyListDetail — the detail of a list whose `editable` is `false`
 * (flow `shared-read`, frames 02, 03, 11).
 *
 * Renders from `GET /v1/selection-lists/{id}` (already loaded by the caller) and
 * `GET …/items?status=all`. A common list also asks the service ONCE which list
 * its key means for this organization (`useEffectiveList`): until that answer
 * lands nothing is guessed — no badge, no notice, no action — so a control never
 * flashes and disappears. The fork action is a SLOT: the fork flow supplies the
 * button; it renders only when the lookup says this very list is the effective
 * one. `GET …/access` is never requested.
 */

import type { ReactNode } from 'react'
import {
  forkCtaFor,
  isCommonList,
  useEffectiveList,
  type SharedList,
} from '../core'
import { DETAIL_COPY } from './copy'
import { ListFacts } from './ListFacts'
import { PanelSkeleton } from './PanelState'
import { ReadOnlyListNotice } from './ReadOnlyListNotice'
import { ReadOnlyListShell } from './ReadOnlyListShell'
import { ReadOnlyValueTable } from './ReadOnlyValueTable'
import * as css from './styles'
import { useListValues } from './useListValues'

export interface ReadOnlyListDetailProps {
  list: SharedList
  /** The fork flow's "Fork to edit…" button, given the list it would fork. */
  forkAction?: (list: SharedList) => ReactNode
  hrefForList: (list: SharedList) => string
  onOpenList: (list: SharedList) => void
  onOpenTranslations: () => void
  onBackToIndex: () => void
  indexHref: string
}

export function ReadOnlyListDetail({
  list,
  forkAction,
  hrefForList,
  onOpenList,
  onOpenTranslations,
  onBackToIndex,
  indexHref,
}: ReadOnlyListDetailProps) {
  const common = isCommonList(list)
  const effective = useEffectiveList(list.key, { skip: !common })
  const values = useListValues(list.id)
  const cta = forkCtaFor({ list, sharedLists: true, effective })

  if (common && cta.kind === 'pending') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <section data-panel="value-table" data-state="loading" style={css.panel}>
          <PanelSkeleton label={DETAIL_COPY.loadingLabel} />
        </section>
      </div>
    )
  }

  return (
    <ReadOnlyListShell
      list={list}
      activeTab="values"
      actions={cta.kind === 'offer' && forkAction ? forkAction(list) : undefined}
      intro={
        <>
          <div style={{ marginBlockEnd: 'var(--space-4)' }}>
            <ReadOnlyListNotice
              list={list}
              cta={cta}
              hrefFor={hrefForList}
              onOpenOwnVersion={onOpenList}
              onRetryLookup={effective.retry}
            />
          </div>
          {common && <ListFacts list={list} />}
        </>
      }
      onSelectTab={tab => {
        if (tab === 'translations') onOpenTranslations()
      }}
      onBackToIndex={onBackToIndex}
      indexHref={indexHref}
    >
      <ReadOnlyValueTable
        values={values}
        footNote={cta.kind === 'offer' ? DETAIL_COPY.valuesFootNote : undefined}
      />
    </ReadOnlyListShell>
  )
}
