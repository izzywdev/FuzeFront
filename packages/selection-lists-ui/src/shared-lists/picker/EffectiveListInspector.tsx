/**
 * EffectiveListInspector — the harness's "which list did the key resolve to"
 * readout (frame 09, `[data-effective-inspector]`). Diagnostics for the demo /
 * e2e harness route, never for an end-user form: the picker renders it only when
 * the host passes `showInspector`, and only while the shared-lists flag is ON
 * and the lookup has an answer.
 *
 * Shows ids and visibility exactly as the service returned them — nothing is
 * looked up to produce it.
 */

import { isCommonList, visibilityOf } from '../core/derive'
import type { SharedList } from '../core/types'
import { effectiveStyles as st } from './styles'

export function EffectiveListInspector({ list }: { list: SharedList }) {
  const common = isCommonList(list)
  const forkedFrom = list.forked_from?.list_id
  return (
    <div data-effective-inspector style={st.inspector}>
      <div style={st.inspectorLabel}>
        Harness inspector — which list the key resolved to
      </div>
      <code dir="ltr">
        {list.id} · {common ? 'platform org' : `org ${list.organization_id}`} ·
        visibility {visibilityOf(list)}
        {forkedFrom ? ` · forked_from ${forkedFrom}` : ''}
      </code>
    </div>
  )
}
