/**
 * ReadOnlyValueTable — the values of a list the caller may read but not change
 * (frames 02, 03, 11).
 *
 * Read-only means ABSENT, not disabled: no "+ Add value", no drag handles, no
 * Edit / Archive / Delete. Archived values are listed and badged so stored
 * values can still be recognised. The Item-id column drops at <= 40em, and the
 * panel never scrolls sideways. Codes are bidi-isolated LTR islands.
 */

import { Badge, Button } from '@fuzefront/design-system'
import { DETAIL_COPY } from './copy'
import { PanelSkeleton, PanelStateBlock } from './PanelState'
import * as css from './styles'
import type { ListValues } from './useListValues'

export interface ReadOnlyValueTableProps {
  values: ListValues
  /** Shown in the foot beside the count, e.g. "Changes happen in your organization's fork". */
  footNote?: string
}

export function ReadOnlyValueTable({ values, footNote }: ReadOnlyValueTableProps) {
  const panelProps = { 'data-panel': 'value-table', 'data-readonly': 'true' } as const

  if (values.phase === 'loading') {
    return (
      <section {...panelProps} data-state="loading" style={css.panel}>
        <PanelSkeleton label={DETAIL_COPY.loadingLabel} />
      </section>
    )
  }

  if (values.phase === 'error') {
    return (
      <section {...panelProps} data-state="error" style={css.panel}>
        <PanelStateBlock
          icon="⚠"
          title={DETAIL_COPY.valuesErrorTitle}
          body={DETAIL_COPY.valuesErrorBody}
          role="alert"
          action={
            <Button variant="secondary" size="sm" data-action="retry" onClick={values.reload}>
              {DETAIL_COPY.retry}
            </Button>
          }
        />
      </section>
    )
  }

  if (values.isEmpty) {
    return (
      <section {...panelProps} data-state="empty" style={css.panel}>
        <PanelStateBlock
          icon="☰"
          title={DETAIL_COPY.valuesEmptyTitle}
          body={DETAIL_COPY.valuesEmptyBody}
        />
      </section>
    )
  }

  return (
    <section {...panelProps} data-state="ready" style={css.panel}>
      <div className="fz-sl-scroll">
        <table className="fz-sl-table" style={css.table}>
          <thead>
            <tr>
              <th scope="col" style={css.th}>{DETAIL_COPY.colLabel}</th>
              <th scope="col" style={css.th}>{DETAIL_COPY.colCode}</th>
              <th scope="col" style={css.th}>{DETAIL_COPY.colStatus}</th>
              <th scope="col" className="fz-sl-hide-sm" style={css.th}>
                {DETAIL_COPY.colItemId}
              </th>
            </tr>
          </thead>
          <tbody>
            {values.rows.map(item => {
              const archived = item.status === 'archived'
              return (
                <tr
                  key={item.id}
                  data-item={item.id}
                  data-archived={archived ? 'true' : undefined}
                >
                  <td
                    style={{
                      ...css.tdName,
                      color: archived ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    }}
                  >
                    {item.label}
                    {item.is_machine && (
                      <span data-machine="true" style={{ marginInlineStart: 'var(--space-2)' }}>
                        <Badge tone="info" size="sm">M</Badge>
                      </span>
                    )}
                  </td>
                  <td style={css.td}>
                    <span style={css.keyChip}>{item.code}</span>
                  </td>
                  <td style={css.td}>
                    <Badge
                      tone={archived ? 'neutral' : 'success'}
                      size="md"
                      data-status={item.status}
                    >
                      {archived ? DETAIL_COPY.statusArchived : DETAIL_COPY.statusActive}
                    </Badge>
                  </td>
                  <td className="fz-sl-hide-sm" style={css.td}>
                    <span style={css.mono}>{item.id}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={css.panelFoot}>
        <span>
          {values.rows.length} {values.rows.length === 1 ? 'value' : 'values'}
          {values.hasMore ? ' loaded' : ''} · {DETAIL_COPY.valuesFootReadOnly}
        </span>
        {values.hasMore && (
          <Button
            variant="ghost"
            size="sm"
            data-action="load-more-values"
            disabled={values.loadingMore}
            onClick={values.loadMore}
          >
            {DETAIL_COPY.valuesLoadMore}
          </Button>
        )}
        {values.loadMoreFailed && (
          <span role="alert" style={{ color: 'var(--error-color)' }}>
            {DETAIL_COPY.valuesErrorTitle}
          </span>
        )}
        {footNote && (
          <span style={css.accessHint}>
            <span aria-hidden="true">🔒</span> {footNote}
          </span>
        )}
      </div>
    </section>
  )
}
