/**
 * ListFacts — ownership facts of a common list (frame 02): who owns it, who
 * can see it, how many values, what the caller can do. The owner is stated from
 * `visibility` and `organization_id` only; no directory lookup.
 */

import type { SharedList } from '../core'
import { DETAIL_COPY } from './copy'
import * as css from './styles'

const dt = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-2xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  paddingBlockStart: 'var(--space-1)',
} as const

export function ListFacts({ list }: { list: SharedList }) {
  return (
    <section data-panel="list-facts" aria-label={DETAIL_COPY.factsLabel} style={css.panel}>
      <div style={css.panelBody}>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 'var(--space-2) var(--space-4)',
            margin: 0,
            fontSize: 'var(--text-sm)',
          }}
        >
          <dt style={dt}>{DETAIL_COPY.factOwner}</dt>
          <dd data-owner-org="platform" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {DETAIL_COPY.ownerPlatform}
          </dd>
          <dt style={dt}>{DETAIL_COPY.factVisibility}</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {DETAIL_COPY.visibilityPlatform}
          </dd>
          <dt style={dt}>{DETAIL_COPY.factValues}</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {list.item_count} · authored in <b style={css.ltrIsland}>{list.source_locale}</b>
          </dd>
          <dt style={dt}>{DETAIL_COPY.factAccess}</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {DETAIL_COPY.accessPlatform}
          </dd>
        </dl>
      </div>
    </section>
  )
}
