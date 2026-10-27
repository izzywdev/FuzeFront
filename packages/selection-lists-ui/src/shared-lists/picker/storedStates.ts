/**
 * Stored values across a fork (frame 10): how each id the host holds renders,
 * decided from the `POST /v1/resolve` outcome alone.
 *
 * Pure — no React, no network. The picker keeps the host's value as it is; this
 * only decides what to SHOW for ids the effective list does not offer itself.
 *
 *  - missing     → "Unknown value" (another org's item, or purged); the id stays.
 *  - redirected  → the service named the org fork's item (`effective_item_id`):
 *                  show THAT label with no badge, notice or dirty marker, and
 *                  mark the matching fork option selected. The value is NOT
 *                  rewritten.
 *  - archived    → still resolves, read but not newly selectable (greyed +
 *                  badge) — also when it was redirected to an archived fork item.
 *  - foreign     → an active item of a list other than the effective one (the
 *                  org's fork is private, or the fork's copy was purged, or the
 *                  fork was archived): its own resolved label, as-is.
 *  - (nothing)   → an active item the effective list offers itself.
 */

import type { StoredValueOutcome } from '../core/types'

export interface StoredValueState {
  kind: 'archived' | 'missing' | 'redirected' | 'foreign'
  id: string
  label?: string
  locale?: string
  status?: string
  /** The org fork's item standing in for this stored id (4.1.0 `effective_item_id`). */
  effectiveId?: string
}

export function storedStatesFor(
  selectedIds: readonly string[],
  outcomes: Readonly<Record<string, StoredValueOutcome>>,
  activeItemIds: ReadonlySet<string>
): StoredValueState[] {
  const states: StoredValueState[] = []
  for (const id of selectedIds) {
    const outcome = outcomes[id]
    if (!outcome) continue
    if (outcome.kind === 'missing') {
      states.push({ kind: 'missing', id })
      continue
    }
    const effectiveId =
      outcome.effectiveItemId !== null && outcome.effectiveItemId !== id
        ? outcome.effectiveItemId
        : undefined
    const base = {
      id,
      label: outcome.label,
      locale: outcome.locale,
      status: outcome.status,
      ...(effectiveId ? { effectiveId } : {}),
    }
    if (outcome.status === 'archived') {
      states.push({ kind: 'archived', ...base })
    } else if (effectiveId) {
      states.push({ kind: 'redirected', ...base })
    } else if (!activeItemIds.has(id)) {
      states.push({ kind: 'foreign', ...base })
    }
  }
  return states
}
