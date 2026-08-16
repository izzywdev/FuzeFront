import { Badge } from '@fuzefront/design-system'
import type { PortalIdentityMode } from '../../services/adminPortalsService'

const TIER_META: Record<
  PortalIdentityMode,
  { label: string; glyph: string; tone: 'info' | 'accent'; hint: string }
> = {
  soft: { label: 'Soft', glyph: '◗', tone: 'info', hint: 'Shares the root Authentik' },
  hard: { label: 'Hard', glyph: '◆', tone: 'accent', hint: 'Its own Authentik instance' },
}

/**
 * The soft/hard identity-tier badge (`data-tier="soft"|"hard"` per
 * design/frames/portals-directory's testHooks). Composes the DS Badge —
 * `info` (cyan) for soft, `accent` (indigo) for hard.
 */
export function PortalTierBadge({ tier }: { tier: PortalIdentityMode }) {
  const meta = TIER_META[tier]
  return (
    <Badge tone={meta.tone} mono title={meta.hint} data-tier={tier}>
      <span aria-hidden="true">{meta.glyph}</span> {meta.label}
    </Badge>
  )
}
