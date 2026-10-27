/**
 * CopiedFromLabel - the "Copied from" cell of frame 07's value table for one
 * fork item, from `origin_item_id` against the source items the page loaded for
 * the provenance check:
 *
 *  - `common "Low"`     - the origin item is known; the label is the COMMON
 *                         item's (a fork may have relabelled it - the code stays).
 *  - `added in this fork` - `origin_item_id` is null.
 *  - `copied`           - copied, but the source is unavailable (or the origin is
 *                         not among its loaded items): no label is invented.
 */

import type { CSSProperties } from 'react'
import type { OriginLabel } from './derive'

const style: CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-sm)',
}

export function CopiedFromLabel({ origin }: { origin: OriginLabel }) {
  let text: string
  switch (origin.kind) {
    case 'added':
      text = 'added in this fork'
      break
    case 'common':
      text = `common “${origin.label}”`
      break
    case 'copied':
      text = 'copied'
      break
  }
  return (
    <span data-copied-from={origin.kind} style={style}>
      {text}
    </span>
  )
}
