/**
 * EffectiveListSource — the OPT-IN provenance caption under a picker
 * (frame 09, and frame 15 at 375 px): which list the key resolved to.
 *
 * Derived from the ONE list the service returned (`forked_from`, `visibility`)
 * — no extra request, and no "behind source" check in a picker. It says nothing
 * about a fork the service ignored (an archived fork falls through to the
 * common list; the caption then simply reads "Common list").
 *
 *  - common     → "◎ Common list — provided by FuzeFront"
 *  - fork       → "⑂ Your organization's version of the common list <name>"
 *  - draft fork → "⑂ Draft — only people with a role see this"
 *  - own list   → "Your organization's list"
 *
 * Rendered only by a host that passes `showSource` (admin / form-builder
 * screens); end-user forms get no caption at all. Renders nothing without a
 * `source` (flag OFF, or the answer is not in yet), so it never appears before
 * the options do.
 *
 * Direction: logical properties only; the list name is bidi-isolated so a Latin
 * key inside Hebrew / Arabic text keeps its order; the glyphs are not mirrored.
 */

import type { EffectiveSource, SharedList } from '../core/types'
import { effectiveStyles as st } from './styles'

export interface EffectiveListSourceProps {
  source: EffectiveSource | null | undefined
  /** The list the service returned (its name labels a fork's common list). */
  list: Pick<SharedList, 'name' | 'key'>
}

export function EffectiveListSource({ source, list }: EffectiveListSourceProps) {
  if (!source) return null
  const name = list.name || list.key

  switch (source.kind) {
    case 'common':
      return (
        <div data-effective-source-caption="platform" style={st.source}>
          <span data-badge="common" style={st.commonBadge}>
            <span aria-hidden="true">◎</span> Common list
          </span>
          <span>provided by FuzeFront</span>
        </div>
      )
    case 'fork':
      return (
        <div data-effective-source-caption="own" style={st.source}>
          <span data-badge="fork" style={st.forkBadge}>
            <span aria-hidden="true">⑂</span> Your organization&apos;s version
          </span>
          <span>
            of the common list{' '}
            <b>
              <bdi>{name}</bdi>
            </b>
          </span>
        </div>
      )
    case 'draft-fork':
      return (
        <div data-effective-source-caption="own" style={st.source}>
          <span style={st.forkBadge}>
            <span aria-hidden="true">⑂</span> Draft — only people with a role
            see this
          </span>
        </div>
      )
    case 'own':
      return (
        <div data-effective-source-caption="own" style={st.source}>
          <span>
            Your organization&apos;s list <bdi>{name}</bdi>
          </span>
        </div>
      )
  }
}
