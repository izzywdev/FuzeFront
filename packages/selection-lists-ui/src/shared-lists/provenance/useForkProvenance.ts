/**
 * useForkProvenance - the ONE shared read behind frame 07's provenance card.
 *
 * Given a fork, it reads `forked_from.list_id` through the shared read (one
 * `GET /v1/selection-lists/{id}`) and, only once that answered with a list,
 * the source's items (for "Copied from"). It never fetches the fork itself, and
 * never joins two services in the browser: both reads are the owning service's.
 *
 * The recorded facts (`recorded`) come from `forked_from` and are available at
 * once - only `behind` waits. A fork with no `forked_from`, or a disabled hook
 * (flag OFF), reads nothing.
 *
 * `retry` re-runs the SOURCE read (frame 07 "Check failed" -> Retry).
 */

import { useCallback, useMemo } from 'react'
import {
  forkProvenanceOf,
  useSharedList,
  type SelectionListForkProvenance,
  type SharedList,
} from '../core'
import { useResource } from '../core/useResource'
import { getSourceItems } from './api'
import {
  behindStateOf,
  originLabelOf,
  revertGateOf,
  sourceRevisionOf,
  type BehindState,
  type OriginLabel,
  type RevertGate,
  type SourceRead,
} from './derive'

export interface ForkProvenance {
  /** The fork the facts belong to. */
  fork: SharedList
  /** `forked_from`, as recorded at copy time (never updated). */
  recorded: SelectionListForkProvenance
  /** The comparison with the source. */
  behind: BehindState
  /** Which header action the provenance read allows. */
  gate: RevertGate
  /** The source's current revision, when the source answered with one. */
  sourceRevision: number | null
  /** The source's display name once read; `null` until then / when unavailable. */
  sourceName: string | null
  /** Resolve a fork item's `origin_item_id` into what the "Copied from" cell says. */
  originLabel: (originItemId: string | null) => OriginLabel
  /** Re-run the source read. */
  retry: () => void
}

/**
 * `fork` is the loaded fork (or `null` while it loads / for a non-fork).
 * `enabled` is the flag: `false` reads nothing and returns `null`.
 */
export function useForkProvenance(
  fork: SharedList | null,
  enabled: boolean
): ForkProvenance | null {
  const recorded = enabled && fork ? forkProvenanceOf(fork) : null
  const sourceId = recorded?.list_id ?? null

  const source = useSharedList(sourceId)

  const read = useMemo<SourceRead>(() => {
    switch (source.phase) {
      case 'ready':
        return { phase: 'ready', list: source.list }
      case 'not_found':
        return { phase: 'not_found' }
      case 'error':
        return { phase: 'error' }
      default:
        return { phase: 'loading' }
    }
  }, [source.phase, source.list])

  // The source's items are only worth reading once the source itself answered:
  // for a gone / unreadable / failed source there is nothing to label from.
  const readySourceId = source.phase === 'ready' ? source.list.id : null
  const items = useResource(
    readySourceId === null ? null : `items|${readySourceId}`,
    signal => getSourceItems(readySourceId as string, signal)
  )

  const labels = useMemo<ReadonlyMap<string, string> | null>(() => {
    if (items.settled.status !== 'done') return null
    return new Map(items.settled.value.map(item => [item.id, item.label]))
  }, [items.settled])

  const originLabel = useCallback(
    (originItemId: string | null) => originLabelOf(originItemId, labels),
    [labels]
  )

  const { reload } = source
  const retry = useCallback(() => reload(), [reload])

  return useMemo<ForkProvenance | null>(() => {
    if (!fork || !recorded) return null
    const behind = behindStateOf(recorded, read)
    return {
      fork,
      recorded,
      behind,
      gate: revertGateOf(behind),
      sourceRevision:
        read.phase === 'ready' ? sourceRevisionOf(read.list) : null,
      sourceName: read.phase === 'ready' ? read.list.name : null,
      originLabel,
      retry,
    }
  }, [fork, recorded, read, originLabel, retry])
}
