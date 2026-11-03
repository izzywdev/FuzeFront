/**
 * useMutationRefusal — the hook a mutation site (value editor, reorder, list
 * settings, translation workbench, auto-fill) uses to hand the fork-relevant
 * refusals to the fork flow while leaving everything else to its 4.0.0 handling.
 *
 *   const { refusal, capture, clear } = useMutationRefusal()
 *   try { await save() } catch (err) {
 *     const r = capture(err)
 *     if (r && r.kind !== 'forbidden') return   // fork_required / not_found: the flow owns it
 *     …existing 4.0.0 handling (incl. its FORBIDDEN message)…
 *   }
 *   …
 *   {refusal && <ForkListFlow refusal={refusal} listId={id} fallback={<its 4.0.0 FORBIDDEN node/>} />}
 *
 * `capture` returns `null` (and keeps no state) while the shared-lists flag is
 * OFF, and for every failure that is not a fork-relevant refusal — so a 409
 * without `reason`, a 5xx, a 400 … are exactly the 4.0.0 behaviour.
 */

import { useCallback, useState } from 'react'
import { classifyMutationError, useSharedLists, type ApiFailure } from '../core'

export type MutationRefusal = Extract<
  ApiFailure,
  { kind: 'fork_required' | 'forbidden' | 'not_found' }
>

const isRefusal = (f: ApiFailure): f is MutationRefusal =>
  f.kind === 'fork_required' || f.kind === 'forbidden' || f.kind === 'not_found'

export function useMutationRefusal(): {
  refusal: MutationRefusal | null
  capture: (err: unknown) => MutationRefusal | null
  clear: () => void
} {
  const { enabled } = useSharedLists()
  const [refusal, setRefusal] = useState<MutationRefusal | null>(null)
  const capture = useCallback(
    (err: unknown): MutationRefusal | null => {
      if (!enabled) return null
      const failure = classifyMutationError(err, true)
      if (!isRefusal(failure)) return null
      setRefusal(failure)
      return failure
    },
    [enabled]
  )
  const clear = useCallback(() => setRefusal(null), [])
  return { refusal, capture, clear }
}
