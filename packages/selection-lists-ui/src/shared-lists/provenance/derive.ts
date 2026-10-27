/**
 * Pure derivations for the fork-provenance flow (frame 07 / 13). No React, no
 * network.
 *
 * Every rule here is one the approved frames state outright; each comment names
 * the frame state so a reviewer can check it against the source of truth.
 */

import type { SelectionListForkProvenance, SharedList } from '../core'

// ── The comparison with the source ────────────────────────────────────────────

/**
 * What the provenance read says about the common list the fork came from
 * (frame 07, "Behind source - every state").
 *
 *  - `checking`        - the source read is in flight. Only the comparison waits;
 *                        the recorded facts and the value editor never do.
 *  - `behind`          - the source's revision is greater than the copied one.
 *  - `up-to-date`      - the revisions are equal.
 *  - `unknown`         - "comparison unavailable": the source answered without a
 *                        usable `revision`. NEVER inferred from `updated_at`
 *                        (item and translation edits do not touch it).
 *  - `source-archived` - the read RETURNED the list with `status: archived`.
 *  - `source-gone`     - 404: purged OR no longer readable by this caller. The
 *                        contract makes the two indistinguishable on purpose.
 *  - `error`           - 5xx / network / anything else: "Couldn't check".
 */
export type BehindState =
  | 'checking'
  | 'behind'
  | 'up-to-date'
  | 'unknown'
  | 'source-archived'
  | 'source-gone'
  | 'error'

/** The settled shape of the source read, independent of how it was fetched. */
export type SourceRead =
  | { phase: 'loading' }
  | { phase: 'ready'; list: SharedList }
  | { phase: 'not_found' }
  | { phase: 'error' }

/**
 * `SelectionList.revision` - the source's CURRENT revision (read-only integer
 * >= 1, the event contract's `listRevision`).
 *
 * The field arrives with contract 4.2.0 / client 2.2.0; a 4.1.x service does not
 * send it. This reads it defensively as an unknown property so the same code is
 * correct against both: an absent, non-integer or non-positive value is `null`
 * ("comparison unavailable"), never a guess. The wire type is not restated here;
 * once the peer client carries the field this still type-checks.
 */
export function sourceRevisionOf(list: SharedList): number | null {
  const revision = (list as { revision?: unknown }).revision
  return typeof revision === 'number' &&
    Number.isInteger(revision) &&
    revision >= 1
    ? revision
    : null
}

/** Frame 07: decide the indicator state from the recorded facts and the source read. */
export function behindStateOf(
  recorded: SelectionListForkProvenance,
  read: SourceRead
): BehindState {
  switch (read.phase) {
    case 'loading':
      return 'checking'
    case 'not_found':
      return 'source-gone'
    case 'error':
      return 'error'
    case 'ready': {
      if (read.list.status === 'archived') return 'source-archived'
      const current = sourceRevisionOf(read.list)
      // A source that is BEHIND the copy cannot happen; treat it as "cannot
      // compare" rather than claim a direction.
      if (current === null || current < recorded.revision) return 'unknown'
      return current > recorded.revision ? 'behind' : 'up-to-date'
    }
  }
}

// ── The header action (frame 07, "Header action by provenance state") ────────

/**
 * Which action the header offers, decided from the provenance read only:
 *
 *  - `source-active`      - behind / up-to-date / unknown: the read returned an
 *                           ACTIVE common list, so archiving the fork sends forms
 *                           back to it -> "Revert to common list...".
 *  - `source-unavailable` - archived / gone, or the source's key no longer
 *                           matches the fork's: the effective-key lookup falls
 *                           through only to an ACTIVE common list WITH THE SAME
 *                           KEY, so the word "revert" never appears ->
 *                           "Archive fork...".
 *  - `source-unknown`     - checking / check failed: no action until the read
 *                           answers (Retry re-runs it).
 */
export type RevertGate =
  'source-active' | 'source-unavailable' | 'source-unknown'

export function revertGateOf(
  state: BehindState,
  sourceKeyChanged = false
): RevertGate {
  switch (state) {
    case 'behind':
    case 'up-to-date':
    case 'unknown':
      // The effective-list lookup resolves by KEY, not by `forked_from.list_id`:
      // if either list was renamed, archiving the fork does not return forms to
      // that source, so the revert promise is not made.
      return sourceKeyChanged ? 'source-unavailable' : 'source-active'
    case 'source-archived':
    case 'source-gone':
      return 'source-unavailable'
    case 'checking':
    case 'error':
      return 'source-unknown'
  }
}

// ── "Copied from" (frame 07, value table) ────────────────────────────────────

/**
 * What the "Copied from" cell says about one fork item.
 *
 *  - `added`  - `origin_item_id` is null/absent: the item was added in the fork.
 *  - `common` - the origin item is among the source items already loaded; `label`
 *               is ITS label (a fork may have relabelled it; the code stays).
 *  - `copied` - copied, but there is no label to name: the source is unavailable
 *               or the origin item is not among the loaded source items.
 */
export type OriginLabel =
  | { kind: 'added' }
  | { kind: 'common'; label: string }
  | { kind: 'copied' }

/**
 * `SelectionListItem.origin_item_id`, absent = null (a 4.0.0 service omits it).
 * Accepts any item-shaped value because the package's own 4.0.0 item type does
 * not declare the 4.1.0 field.
 */
export function originItemIdOf(item: unknown): string | null {
  const origin = (item as { origin_item_id?: unknown } | null)?.origin_item_id
  return typeof origin === 'string' && origin !== '' ? origin : null
}

export function originLabelOf(
  originItemId: string | null,
  sourceLabels: ReadonlyMap<string, string> | null
): OriginLabel {
  if (originItemId === null) return { kind: 'added' }
  const label = sourceLabels?.get(originItemId)
  return label === undefined ? { kind: 'copied' } : { kind: 'common', label }
}

/**
 * The source (an active, readable list) no longer carries the fork's key - one of
 * them was renamed. Only true when the source answered; an unread source is not
 * "changed".
 */
export function sourceKeyChangedOf(
  forkKey: string,
  read: SourceRead
): boolean {
  return read.phase === 'ready' && read.list.key !== forkKey
}
