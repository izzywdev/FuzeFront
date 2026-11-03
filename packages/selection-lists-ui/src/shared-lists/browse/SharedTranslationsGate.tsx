/**
 * SharedTranslationsGate — decides, while the release flag is ON, whether the
 * translation routes show the read-only workbench (frame 03) or the 4.0.0
 * workbench.
 *
 * The list is read once (`useSharedList`): `editable = false` → the read-only
 * locale index / locale view; `editable` true or absent → the 4.0.0 workbench,
 * untouched (absent is UNKNOWN, never read-only). A 404 is "List not found",
 * never a 403.
 */

import type { ReactNode } from 'react'
import { Button } from '@fuzefront/design-system'
import { editableStateOf, useSharedList } from '../core'
import { DETAIL_COPY } from './copy'
import { PanelSkeleton, PanelStateBlock } from './PanelState'
import { ReadOnlyTranslations } from './ReadOnlyTranslations'
import * as css from './styles'

export interface SharedTranslationsGateProps {
  listId: string
  /** Present = the read-only locale view for that locale. */
  locale: string | undefined
  /** The 4.0.0 translation workbench. */
  renderWorkbench: () => ReactNode
  hrefForLocale: (locale: string) => string
  onOpenLocale: (locale: string) => void
  onBackToLocales: () => void
  onOpenValues: () => void
  onBackToIndex: () => void
  indexHref: string
}

export function SharedTranslationsGate({
  listId,
  locale,
  renderWorkbench,
  hrefForLocale,
  onOpenLocale,
  onBackToLocales,
  onOpenValues,
  onBackToIndex,
  indexHref,
}: SharedTranslationsGateProps) {
  const state = useSharedList(listId)

  if (state.phase === 'ready') {
    if (editableStateOf(state.list) !== 'read-only') return <>{renderWorkbench()}</>
    return (
      <ReadOnlyTranslations
        list={state.list}
        locale={locale}
        hrefForLocale={hrefForLocale}
        onOpenLocale={onOpenLocale}
        onBackToLocales={onBackToLocales}
        onOpenValues={onOpenValues}
        onBackToIndex={onBackToIndex}
        indexHref={indexHref}
      />
    )
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <section data-panel="value-table" data-state={state.phase === 'loading' ? 'loading' : state.phase === 'not_found' ? 'not-found' : 'error'} style={css.panel}>
        {state.phase === 'loading' && <PanelSkeleton label={DETAIL_COPY.loadingLabel} />}
        {state.phase === 'not_found' && (
          <PanelStateBlock
            icon="∅"
            title={DETAIL_COPY.notFoundTitle}
            body={DETAIL_COPY.notFoundBody}
            bodyProps={{ 'data-error': 'NOT_FOUND' }}
          />
        )}
        {state.phase === 'error' && (
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
        )}
      </section>
    </div>
  )
}
