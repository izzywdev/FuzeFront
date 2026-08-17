import { Badge } from '@fuzefront/design-system'
import type { ProvenanceKind } from '../../lib/provenance'

const TONE: Record<ProvenanceKind, 'info' | 'neutral' | 'warning' | 'error'> = {
  set: 'info',
  inherited: 'neutral',
  locked: 'warning',
  default: 'neutral',
  stale: 'error',
}

export interface ProvenanceBadgeProps {
  kind: ProvenanceKind
  /** The rendered label — the host composes it with `t(editor.provenance*, {...})`. */
  label: string
}

/**
 * Renders exactly one provenance state per `EffectiveConfigEntry` — the point
 * of the whole editor (see `deriveProvenance`). Composes the base DS `Badge`
 * (free-form `tone`) rather than `StatusPill`'s fixed lifecycle vocabulary,
 * matching the `MembershipRoleBadge` precedent: a config-domain vocabulary is
 * product-specific, so it stays in this package rather than extending a base
 * primitive's fixed status list.
 */
export function ProvenanceBadge({ kind, label }: ProvenanceBadgeProps) {
  return (
    <Badge tone={TONE[kind]} dot mono data-provenance={kind}>
      {label}
    </Badge>
  )
}
