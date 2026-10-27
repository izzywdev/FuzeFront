/**
 * useResource — the one request/settle primitive the shared-lists data hooks
 * share. Internal to `shared-lists/core` (not part of the package surface).
 *
 * Contract:
 *  - `key` identifies WHAT is being loaded. `null` means "nothing to load" →
 *    `idle`. When `key` changes the previous answer is never shown for the new
 *    key: the hook reports `loading` until the new request settles (so a stale
 *    answer cannot be rendered under a new key, with no flash-then-correct).
 *  - A superseded or unmounted request is aborted and its answer discarded.
 *  - An aborted request is never an error.
 *  - `reload()` re-runs the request for the same key (Retry).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isAbortError } from './errors'

export type Settled<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; value: T }
  | { status: 'failed'; error: unknown }

export interface Resource<T> {
  settled: Settled<T>
  /** Re-run the request for the same key. */
  reload: () => void
  /** Changes whenever the key or a reload starts a new request; `null` while idle. */
  token: string | null
}

export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>
): Resource<T> {
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  const [tick, setTick] = useState(0)
  const [entry, setEntry] = useState<{
    token: string
    settled: Settled<T>
  } | null>(null)

  // A unique, monotonic GENERATION per request: it advances on EVERY key or
  // reload transition, including A -> B -> A and A -> null -> A, so state keyed
  // on `token` (the entry below, pagination in useSharedListIndex, patches in
  // useSharedList) can never attach to a later request that merely reuses an
  // earlier key. Derived during render (React re-renders at once, discarding
  // this pass), so no render ever sees the new key with the old generation.
  const [gen, setGen] = useState({ key, tick, id: 0 })
  let current = gen
  if (gen.key !== key || gen.tick !== tick) {
    current = { key, tick, id: gen.id + 1 }
    setGen(current)
  }
  const token = key === null ? null : `${key}#${current.id}`

  useEffect(() => {
    if (token === null) return undefined
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      value => {
        if (!controller.signal.aborted)
          setEntry({ token, settled: { status: 'done', value } })
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setEntry({ token, settled: { status: 'failed', error } })
      }
    )
    return () => controller.abort()
  }, [token])

  const reload = useCallback(() => setTick(n => n + 1), [])

  let settled: Settled<T>
  if (token === null) settled = { status: 'idle' }
  else if (entry !== null && entry.token === token) settled = entry.settled
  else settled = { status: 'loading' }
  return { settled, reload, token }
}
