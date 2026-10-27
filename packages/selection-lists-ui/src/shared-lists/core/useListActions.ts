/**
 * Command hooks: fork, restore a fork, change visibility.
 *
 * Commands go to the owning service and resolve to a typed outcome (see
 * `api.ts`). Each hook adds one thing the wrappers cannot: a SINGLE-FLIGHT
 * guard. While a request is in flight a second call returns the same promise
 * and sends nothing — the UI also disables its controls natively, this is the
 * belt to that pair of braces (frame 05: a second activation must not send a
 * concurrent request).
 *
 * `state`: `idle` → `submitting` → `done` (with the outcome). A `done` outcome
 * stays until `reset()`, so a refusal can sit in place of the dialog's options.
 * Retrying after an `unknown_outcome` re-sends the same request; for fork that
 * is safe — the service is idempotent per (organization, source).
 *
 * The returned `list` of a success is the new truth: patch the cache from it
 * (and send `X-Fuze-Min-Version` on the next list read when the host supports
 * it) instead of waiting for a re-read.
 *
 * Mount these only inside flag-ON UI. They do not consult the flag: with it OFF
 * the dialog/control that owns them is never rendered.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { changeVisibility, forkList, restoreList } from './api'
import type {
  ForkOutcome,
  ForkVisibility,
  RestoreOutcome,
  SelectionListId,
  SelectionListVisibility,
  VisibilityOutcome,
} from './types'

export type ActionState<R> =
  { status: 'idle' } | { status: 'submitting' } | { status: 'done'; outcome: R }

export interface ListAction<A extends unknown[], R> {
  state: ActionState<R>
  /** Run the command. While one is in flight this returns that same promise. */
  run: (...args: A) => Promise<R>
  /** Back to `idle` (e.g. the dialog was dismissed). Does not cancel a request in flight. */
  reset: () => void
}

function useListAction<A extends unknown[], R>(
  command: (...args: A) => Promise<R>
): ListAction<A, R> {
  const [state, setState] = useState<ActionState<R>>({ status: 'idle' })
  const inFlight = useRef<Promise<R> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    (...args: A): Promise<R> => {
      if (inFlight.current) return inFlight.current
      setState({ status: 'submitting' })
      // Writes are never aborted on unmount: the service may already have applied
      // them, and the outcome is only discarded (an unmounted view has no state to set).
      const promise = command(...args).then(
        outcome => {
          inFlight.current = null
          if (mounted.current) setState({ status: 'done', outcome })
          return outcome
        },
        (err: unknown) => {
          inFlight.current = null
          if (mounted.current) setState({ status: 'idle' })
          throw err
        }
      )
      inFlight.current = promise
      return promise
    },
    [command]
  )

  const reset = useCallback(() => setState({ status: 'idle' }), [])
  return { state, run, reset }
}

// Module-level so the hooks' `run` identities are stable across renders.
const fork = (listId: SelectionListId, visibility?: ForkVisibility) =>
  forkList(listId, visibility)
const restore = (listId: SelectionListId) => restoreList(listId)
const setVisibility = (
  listId: SelectionListId,
  visibility: SelectionListVisibility
) => changeVisibility(listId, visibility)

/** Fork a common list: `run(sourceListId, visibility?)`. */
export function useForkList(): ListAction<
  [SelectionListId, ForkVisibility?],
  ForkOutcome
> {
  return useListAction(fork)
}

/** Restore an archived fork: `run(listId)`. */
export function useRestoreList(): ListAction<
  [SelectionListId],
  RestoreOutcome
> {
  return useListAction(restore)
}

/** Change a list's visibility: `run(listId, visibility)`. */
export function useChangeVisibility(): ListAction<
  [SelectionListId, SelectionListVisibility],
  VisibilityOutcome
> {
  return useListAction(setVisibility)
}
