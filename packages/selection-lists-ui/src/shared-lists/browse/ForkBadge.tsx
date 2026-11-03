/**
 * ForkBadge — marks a list that was forked from a common list (frame 01).
 *
 * Renders only when `forked_from` is non-null; the pointer may dangle (the
 * common source can have been purged), so the badge states the fact the row
 * carries and nothing about the source's current state.
 */

import { Badge } from '@fuzefront/design-system'
import { forkProvenanceOf, type SharedList } from '../core'
import { FORK_BADGE_LABEL } from './copy'

export interface ForkBadgeProps {
  list: Pick<SharedList, 'forked_from' | 'key'>
}

export function ForkBadge({ list }: ForkBadgeProps) {
  if (forkProvenanceOf(list as SharedList) === null) return null
  return (
    <Badge
      tone="accent"
      size="md"
      data-badge="fork"
      title={`forked_from: common list ${list.key}`}
    >
      <span aria-hidden="true">⑂</span> {FORK_BADGE_LABEL}
    </Badge>
  )
}
