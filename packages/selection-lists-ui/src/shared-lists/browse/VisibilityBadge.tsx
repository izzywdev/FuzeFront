/**
 * VisibilityBadge — who can see a list (frames 01, 02, 03, 11).
 *
 * Reads `visibility` only; an absent value means `private` (a 4.0.0-behaviour
 * service omits it). A common (`platform`) list also carries `data-badge="common"`
 * so it is recognisable without reading the label.
 */

import { Badge } from '@fuzefront/design-system'
import { visibilityOf, type SharedList, type SelectionListVisibility } from '../core'
import { VISIBILITY_LABEL } from './copy'

type Tone = 'neutral' | 'success' | 'info'

const TONE: Record<SelectionListVisibility, Tone> = {
  private: 'neutral',
  org: 'success',
  platform: 'info',
}

export interface VisibilityBadgeProps {
  list: Pick<SharedList, 'visibility'>
  /** `row` = the compact index label ("Common"); `detail` = the header label ("Common list"). */
  variant?: 'row' | 'detail'
}

export function VisibilityBadge({ list, variant = 'row' }: VisibilityBadgeProps) {
  const visibility = visibilityOf(list as SharedList)
  const copy = VISIBILITY_LABEL[visibility]
  return (
    <Badge
      tone={TONE[visibility]}
      size="md"
      data-visibility={visibility}
      data-badge={visibility === 'platform' ? 'common' : undefined}
      title={`visibility: ${visibility}`}
    >
      <span aria-hidden="true">{copy.glyph}</span>{' '}
      {variant === 'detail' ? copy.detail : copy.row}
    </Badge>
  )
}
